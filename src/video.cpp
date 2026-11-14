#include "video.h"
#include "gfx.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>
}

static const size_t kQueueMax = 4;

VideoPlayer::VideoPlayer(const std::string& p) : path(p) {
    th = std::thread([this] { run(); });
}

VideoPlayer::~VideoPlayer() {
    quit = true;
    cv.notify_all();
    if (th.joinable()) th.join();
    if (tex) glDeleteTextures(1, &tex);
}

void VideoPlayer::seek(double s) {
    std::lock_guard<std::mutex> lk(mtx);
    seekReq = true;
    seekTarget = std::max(0.0, s);
    serial++;
    for (auto& f : queue) pool.push_back(std::move(f.rgba));
    queue.clear();
    pos = seekTarget;
    takeNext = true;
    cv.notify_all();
}

void VideoPlayer::update(double dt) {
    if (!paused) pos += dt * speed;
    VideoFrame latest;
    bool got = false;
    {
        std::lock_guard<std::mutex> lk(mtx);
        const double fd = frameDur.load();
        while (!queue.empty()) {
            VideoFrame& f = queue.front();
            bool take = false;
            if (f.serial != serial) {
                pool.push_back(std::move(f.rgba));
                queue.pop_front();
                continue;
            }
            if (takeNext) {
                take = true;
                curLoop = f.loop;
            } else if (f.loop == curLoop) {
                take = f.pts <= pos;
            } else if (pos >= lastPts + fd) {   // file wrapped: restart the clock
                take = true;
                curLoop = f.loop;
                pos = f.pts;
            }
            if (!take) break;
            takeNext = false;
            lastPts = f.pts;
            if (got) pool.push_back(std::move(latest.rgba));
            latest = std::move(f);
            got = true;
            queue.pop_front();
        }
        // If we fell far behind (e.g. the app was stalled), resync instead of fast-forwarding.
        if (!got && !queue.empty() && queue.front().loop == curLoop && pos < queue.front().pts - 1.0)
            pos = queue.front().pts;
    }
    if (got) {
        cv.notify_all();
        int fw = vw, fh = vh;
        if (!tex || fw != w || fh != h) {
            if (tex) glDeleteTextures(1, &tex);
            w = fw; h = fh;
            tex = gfx::makeTexture(w, h);
        }
        if (latest.rgba.size() == (size_t)w * h * 4) {
            glBindTexture(GL_TEXTURE_2D, tex);
            glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
            glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, latest.rgba.data());
            hasFrame = true;
        }
        std::lock_guard<std::mutex> lk(mtx);
        pool.push_back(std::move(latest.rgba));
    }
    double d = duration.load();
    if (d > 0 && pos > d + 1.0) pos = d;
}

void VideoPlayer::run() {
    AVFormatContext* fmt = nullptr;
    AVCodecContext* cc = nullptr;
    SwsContext* sws = nullptr;
    AVFrame* frame = av_frame_alloc();
    AVPacket* pkt = av_packet_alloc();
    int vs = -1;
    double startTime = 0, tb = 0;
    int mySerial = 0, loop = 0;
    double dropBefore = -1;

    auto fail = [&] { error = true; };
    do {
        if (avformat_open_input(&fmt, path.c_str(), nullptr, nullptr) < 0) { fail(); break; }
        if (avformat_find_stream_info(fmt, nullptr) < 0) { fail(); break; }
        const AVCodec* codec = nullptr;
        vs = av_find_best_stream(fmt, AVMEDIA_TYPE_VIDEO, -1, -1, &codec, 0);
        if (vs < 0 || !codec) { fail(); break; }
        AVStream* st = fmt->streams[vs];
        cc = avcodec_alloc_context3(codec);
        avcodec_parameters_to_context(cc, st->codecpar);
        cc->thread_count = (int)std::min(8u, std::max(1u, std::thread::hardware_concurrency()));
        cc->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;
        if (avcodec_open2(cc, codec, nullptr) < 0) { fail(); break; }
        tb = av_q2d(st->time_base);
        startTime = st->start_time != AV_NOPTS_VALUE ? st->start_time * tb : 0;
        if (fmt->duration > 0) duration = fmt->duration / (double)AV_TIME_BASE;
        AVRational fr = av_guess_frame_rate(fmt, st, nullptr);
        if (fr.num > 0 && fr.den > 0) frameDur = av_q2d(av_inv_q(fr));
        for (unsigned i = 0; i < fmt->nb_streams; i++)
            if ((int)i != vs) fmt->streams[i]->discard = AVDISCARD_ALL;
    } while (false);

    auto push = [&](AVFrame* f) {
        double pts = (f->best_effort_timestamp != AV_NOPTS_VALUE ? f->best_effort_timestamp * tb : 0) - startTime;
        if (pts < dropBefore) return;
        dropBefore = -1;
        int fw = f->width, fh = f->height;
        sws = sws_getCachedContext(sws, fw, fh, (AVPixelFormat)f->format, fw, fh, AV_PIX_FMT_RGBA,
                                   SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
        if (!sws) return;
        VideoFrame vf;
        {
            std::lock_guard<std::mutex> lk(mtx);
            if (!pool.empty()) { vf.rgba = std::move(pool.back()); pool.pop_back(); }
        }
        vf.rgba.resize((size_t)fw * fh * 4);
        uint8_t* dst[4] = {vf.rgba.data(), nullptr, nullptr, nullptr};
        int dstStride[4] = {fw * 4, 0, 0, 0};
        sws_scale(sws, f->data, f->linesize, 0, fh, dst, dstStride);
        vf.pts = pts;
        vf.loop = loop;
        std::unique_lock<std::mutex> lk(mtx);
        cv.wait(lk, [&] { return quit || seekReq || queue.size() < kQueueMax; });
        if (quit || seekReq) return;
        vf.serial = mySerial;
        vw = fw; vh = fh;
        queue.push_back(std::move(vf));
    };

    while (!quit && !error) {
        {
            std::lock_guard<std::mutex> lk(mtx);
            if (seekReq) {
                seekReq = false;
                mySerial = serial;
                int64_t ts = (int64_t)((seekTarget + startTime) / tb);
                av_seek_frame(fmt, vs, ts, AVSEEK_FLAG_BACKWARD);
                avcodec_flush_buffers(cc);
                dropBefore = seekTarget - frameDur.load() * 0.5;
            }
        }
        int r = av_read_frame(fmt, pkt);
        if (r < 0) {   // end of file: drain, then loop back to the start
            avcodec_send_packet(cc, nullptr);
            while (!quit && avcodec_receive_frame(cc, frame) >= 0) push(frame);
            avcodec_flush_buffers(cc);
            if (av_seek_frame(fmt, vs, (int64_t)(startTime / tb), AVSEEK_FLAG_BACKWARD) < 0) {
                avformat_seek_file(fmt, -1, INT64_MIN, 0, INT64_MAX, 0);
            }
            loop++;
            dropBefore = -1;
            if (duration.load() <= 0) {   // still image: no need to spin
                std::unique_lock<std::mutex> lk(mtx);
                cv.wait_for(lk, std::chrono::milliseconds(200), [&] { return quit.load() || seekReq; });
            }
            continue;
        }
        if (pkt->stream_index == vs && avcodec_send_packet(cc, pkt) >= 0) {
            while (!quit && avcodec_receive_frame(cc, frame) >= 0) {
                push(frame);
                std::lock_guard<std::mutex> lk(mtx);
                if (seekReq) break;
            }
        }
        av_packet_unref(pkt);
    }
    av_frame_free(&frame);
    av_packet_free(&pkt);
    if (sws) sws_freeContext(sws);
    if (cc) avcodec_free_context(&cc);
    if (fmt) avformat_close_input(&fmt);
}

bool grabThumbnail(const std::string& path, int tw, int th, std::vector<uint8_t>& rgba) {
    AVFormatContext* fmt = nullptr;
    if (avformat_open_input(&fmt, path.c_str(), nullptr, nullptr) < 0) return false;
    bool ok = false;
    AVCodecContext* cc = nullptr;
    AVFrame* frame = av_frame_alloc();
    AVPacket* pkt = av_packet_alloc();
    do {
        if (avformat_find_stream_info(fmt, nullptr) < 0) break;
        const AVCodec* codec = nullptr;
        int vs = av_find_best_stream(fmt, AVMEDIA_TYPE_VIDEO, -1, -1, &codec, 0);
        if (vs < 0 || !codec) break;
        cc = avcodec_alloc_context3(codec);
        avcodec_parameters_to_context(cc, fmt->streams[vs]->codecpar);
        if (avcodec_open2(cc, codec, nullptr) < 0) break;
        if (fmt->duration > 2 * AV_TIME_BASE) {   // skip likely-black first frames
            av_seek_frame(fmt, -1, fmt->duration / 10, AVSEEK_FLAG_BACKWARD);
        }
        bool got = false;
        for (int guard = 0; guard < 500 && !got; guard++) {
            int r = av_read_frame(fmt, pkt);
            if (r < 0) avcodec_send_packet(cc, nullptr);
            else if (pkt->stream_index == vs) avcodec_send_packet(cc, pkt);
            if (r >= 0) av_packet_unref(pkt);
            if (avcodec_receive_frame(cc, frame) >= 0) got = true;
            else if (r < 0) break;
        }
        if (!got) break;
        SwsContext* sws = sws_getContext(frame->width, frame->height, (AVPixelFormat)frame->format, tw, th,
                                         AV_PIX_FMT_RGBA, SWS_BILINEAR, nullptr, nullptr, nullptr);
        if (!sws) break;
        rgba.resize((size_t)tw * th * 4);
        uint8_t* dst[4] = {rgba.data(), nullptr, nullptr, nullptr};
        int stride[4] = {tw * 4, 0, 0, 0};
        sws_scale(sws, frame->data, frame->linesize, 0, frame->height, dst, stride);
        sws_freeContext(sws);
        ok = true;
    } while (false);
    av_frame_free(&frame);
    av_packet_free(&pkt);
    if (cc) avcodec_free_context(&cc);
    avformat_close_input(&fmt);
    return ok;
}

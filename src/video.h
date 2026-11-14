// Strodano VJ - threaded FFmpeg video player (GPL-3.0)
#pragma once
#include <glad/gl.h>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

struct VideoFrame {
    std::vector<uint8_t> rgba;
    double pts = 0;
    int serial = 0;   // increments on every seek
    int loop = 0;     // increments every time the file wraps
};

// Decodes on its own thread into a small queue; the render thread only uploads
// the frame that is due, so a slow disk or decoder never blocks the UI/output.
class VideoPlayer {
public:
    explicit VideoPlayer(const std::string& path);
    ~VideoPlayer();
    void update(double dt);        // render thread: advance clock, upload due frame
    void seek(double seconds);
    bool ready() const { return hasFrame; }
    bool failed() const { return error.load(); }

    GLuint tex = 0;
    int w = 0, h = 0;
    double pos = 0;                // seconds
    std::atomic<double> duration{0};
    float speed = 1.0f;
    bool paused = false;
    std::string path;

private:
    void run();
    std::thread th;
    std::mutex mtx;
    std::condition_variable cv;
    std::deque<VideoFrame> queue;
    std::vector<std::vector<uint8_t>> pool;
    std::atomic<bool> quit{false}, error{false};
    std::atomic<int> vw{0}, vh{0};
    std::atomic<double> frameDur{1.0 / 30.0};
    bool seekReq = false;
    double seekTarget = 0;
    int serial = 0;
    int curLoop = 0;
    double lastPts = -1;
    bool hasFrame = false;
    bool takeNext = true;
};

// Decode one frame scaled to tw x th (RGBA, top-down). Used for clip thumbnails.
bool grabThumbnail(const std::string& path, int tw, int th, std::vector<uint8_t>& rgba);

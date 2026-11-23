# Strodano VJ - builds web/models3d.js, the artist-made models of the 3D object scenes (web/lowpoly.js), from .glb files. GPL-3.0 (this script).
# Run it with Blender, no window:
#   blender --background --factory-startup --python tools/models3d.py -- <folder of .glb files> web/models3d.js [triangles per model, default 2600]
# Every <name>.glb becomes LP_MODELS.<name>. The models themselves are other people's work under CC0 (see tools/models3d-credits.md);
# only add files whose licence allows it. For each file: every mesh joined (in its rest pose), thinned to the triangle budget,
# and written as  positions (int16 x 3, the longest side spans the whole range) | colour number per corner (uint8) | triangle
# corners (uint16), base64. A face's colour is its material's base colour (the picture's colour at the face when the material
# has a texture; the emission colour, flagged as glowing, when it emits). No normals are stored: corners that Blender keeps
# apart (hard edges, colour borders) stay apart here, and lowpoly.js averages the faces round each corner, which gives the same
# smooth and hard edges back.
import bpy, sys, os, json, base64, struct, math

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, BUDGET = args[0], args[1], int(args[2]) if len(args) > 2 else 2600


def srgb(v):
    v = max(0.0, min(1.0, v))
    return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


def socket(node, *names):
    for n in names:
        s = node.inputs.get(n)
        if s is not None:
            return s
    return None


def material_colour(mat):
    """-> (kind, value, glows): ('rgb', (r, g, b) in sRGB 0..1), ('tex', image) or ('vcol', (r, g, b) linear: times the mesh's own colours)"""
    if mat is None or not mat.use_nodes:
        c = mat.diffuse_color if mat else (0.8, 0.8, 0.8, 1)
        return ('rgb', tuple(srgb(x) for x in c[:3]), False)
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return ('rgb', (0.8, 0.8, 0.8), False)
    em, es = socket(bsdf, 'Emission Color', 'Emission'), socket(bsdf, 'Emission Strength')
    if em is not None and es is not None and not em.is_linked and es.default_value > 0.01 and max(em.default_value[:3]) > 0.05:
        return ('rgb', tuple(srgb(x) for x in em.default_value[:3]), True)
    base = socket(bsdf, 'Base Color')
    if base.is_linked and base.links[0].from_node.type == 'MIX':   # the importer's "colour x the mesh's own colours"
        tint = next((tuple(i.default_value[:3]) for i in base.links[0].from_node.inputs if i.type == 'RGBA' and not i.is_linked), (1.0, 1.0, 1.0))
        return ('vcol', tint, False)
    if base.is_linked:
        node = base.links[0].from_node
        seen = 0
        while node is not None and node.type != 'TEX_IMAGE' and seen < 6:   # through a mix / multiply node to the picture
            nxt = next((l.from_node for s in node.inputs for l in s.links), None)
            node, seen = nxt, seen + 1
        if node is not None and node.type == 'TEX_IMAGE' and node.image is not None and node.image.size[0] > 0:
            return ('tex', node.image, False)
    return ('rgb', tuple(srgb(x) for x in base.default_value[:3]), False)


def convert(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.name.startswith('Icosphere')]   # that one is a rig helper in Quaternius files
    if not meshes:
        raise RuntimeError('no mesh')
    dg = bpy.context.evaluated_depsgraph_get()
    total = sum(len(o.evaluated_get(dg).to_mesh().loop_triangles) or len(o.data.polygons) * 2 for o in meshes)
    ratio = min(1.0, BUDGET / max(1, total))
    pixels = {}
    verts, index, cols, palette, glow, tris = {}, [], [], {}, [], 0
    for o in meshes:
        if ratio < 0.98 and len(o.data.polygons) > 40:
            m = o.modifiers.new('thin', 'DECIMATE')
            m.ratio = ratio
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        wm = ev.matrix_world
        nm = wm.to_3x3().inverted_safe().transposed()
        uv = me.uv_layers.active.data if me.uv_layers.active else None
        normals = me.corner_normals
        vc = me.color_attributes.active_color or (me.color_attributes[0] if len(me.color_attributes) else None)
        mats = [material_colour(s.material) for s in o.material_slots] or [('rgb', (0.8, 0.8, 0.8), False)]
        for t in me.loop_triangles:
            kind, val, em = mats[min(t.material_index, len(mats) - 1)]
            if kind == 'tex' and uv is not None:
                img = val
                if img.name not in pixels:
                    pixels[img.name] = (list(img.pixels), img.size[0], img.size[1], img.channels)
                px, w, h, ch = pixels[img.name]
                u = sum(uv[l].uv[0] for l in t.loops) / 3 % 1.0
                v = sum(uv[l].uv[1] for l in t.loops) / 3 % 1.0
                i = (min(h - 1, int(v * h)) * w + min(w - 1, int(u * w))) * ch
                rgb = tuple(px[i:i + 3])
            elif kind == 'tex':
                rgb = (0.8, 0.8, 0.8)
            elif kind == 'vcol':
                idx = t.loops if vc is not None and vc.domain == 'CORNER' else t.vertices
                own = [sum(vc.data[i].color[a] for i in idx) / 3 for a in range(3)] if vc is not None else (1.0, 1.0, 1.0)
                rgb = tuple(srgb(val[a] * own[a]) for a in range(3))
            else:
                rgb = val
            key = tuple(min(31, int(c * 31 + 0.5)) for c in rgb) + (1 if em else 0,)
            ci = palette.setdefault(key, len(palette))
            if ci > 254:
                ci = 254
            for li, vi in zip(t.loops, t.vertices):
                p = wm @ me.vertices[vi].co
                n = (nm @ normals[li].vector).normalized()
                # Blender is z up, the app y up
                k = (round(p.x, 4), round(p.z, 4), round(-p.y, 4), round(n.x, 1), round(n.z, 1), round(-n.y, 1), ci)
                at = verts.get(k)
                if at is None:
                    at = verts[k] = len(verts)
                    cols.append(ci)
                index.append(at)
            tris += 1
        ev.to_mesh_clear()
    if len(verts) > 65535:
        raise RuntimeError('too many corners: lower the triangle budget')
    P = [k[:3] for k in verts]   # dicts keep the order things were added in
    lo = [min(p[a] for p in P) for a in range(3)]
    hi = [max(p[a] for p in P) for a in range(3)]
    size = max(hi[a] - lo[a] for a in range(3)) or 1.0
    mid = [(lo[a] + hi[a]) / 2 for a in range(3)]
    data = b''.join(struct.pack('<3h', *(int(round((p[a] - mid[a]) / size * 65534)) for a in range(3))) for p in P)
    data += bytes(cols)
    if len(data) % 2:
        data += b'\0'
    data += struct.pack('<%dH' % len(index), *index)
    pal = [0] * len(palette)
    for key, i in palette.items():
        if i < 255:
            pal[i] = ((key[0] * 255 // 31) << 16 | (key[1] * 255 // 31) << 8 | (key[2] * 255 // 31)) + (0x1000000 if key[3] else 0)
    return {'n': len(P), 't': tris, 'pal': pal[:255], 'd': base64.b64encode(data).decode('ascii')}, total


out, report = {}, []
for f in sorted(os.listdir(SRC)):
    if not f.lower().endswith('.glb'):
        continue
    name = os.path.splitext(f)[0]
    try:
        out[name], was = convert(os.path.join(SRC, f))
        report.append('%s: %d -> %d triangles, %d corners, %d colours, %d KB' % (name, was, out[name]['t'], out[name]['n'], len(out[name]['pal']), len(out[name]['d']) // 1024))
    except Exception as e:
        report.append('%s: FAILED %s' % (name, e))
head = ('// Strodano VJ (web) - the artist-made models of the 3D object scenes. Built by tools/models3d.py: do not edit by hand.\n'
        '// The models are CC0 (public domain) works by the people listed in tools/models3d-credits.md; this file as a whole is GPL-3.0.\n'
        "'use strict';\nwindow.LP_MODELS = ")
with open(OUT, 'w', newline='\n') as fh:
    fh.write(head + json.dumps(out, separators=(',', ':')) + ';\n')
print('MODELS3D\n' + '\n'.join(report))

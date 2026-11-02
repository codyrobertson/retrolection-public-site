#!/usr/bin/env python3
"""
Hand-drawn self portrait for illo-gl.js. Every line is placed by eye from measured positions on the reference photo
(viewBox 560x747, photo scaled to that width); only the repetitive texture (hair strands, beard flicks) is generated
inside hand-drawn boundaries. Writes public/illos/self.svg.
"""
import math, random, sys

R = random.Random(11)
out = {"9h": [], "3b": [], "ball": []}

def cr(pts, closed=False, t=0.5):
    """Catmull-Rom through points -> cubic path"""
    n = len(pts); P = lambda i: pts[i % n] if closed else pts[max(0, min(n - 1, i))]
    d = f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"
    for i in range(n if closed else n - 1):
        p0, p1, p2, p3 = P(i - 1), P(i), P(i + 1), P(i + 2)
        c1 = (p1[0] + (p2[0] - p0[0]) * t / 3 * 2 / 2, p1[1] + (p2[1] - p0[1]) * t / 3 * 2 / 2)
        c2 = (p2[0] - (p3[0] - p1[0]) * t / 3 * 2 / 2, p2[1] - (p3[1] - p1[1]) * t / 3 * 2 / 2)
        d += f" C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return d + (" Z" if closed else "")

def poly(pts): return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z"

def inside(pt, pg):
    x, y = pt; c = False
    for i in range(len(pg)):
        (x1, y1), (x2, y2) = pg[i], pg[(i + 1) % len(pg)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def add(kind, d, w=None, a=None, extra=""):
    attrs = (f' data-w="{w}"' if w else "") + (f' data-a="{a}"' if a else "") + extra
    out[kind].append(f'<path d="{d}"{attrs}/>')

def line(pts, w=None, a=None, extra=""): add("ball", cr(pts), w, a, extra)
def guide(pts, w=None, a=None): add("9h", cr(pts), w, a or .4)
def hatch(kind, d, spec, a=None, evenodd=False): add(kind, d, None, a, f' data-hatch="{spec}"' + (' fill-rule="evenodd"' if evenodd else ""))

# ================= construction (9H) =================
guide([(305, 62), (306, 200), (305, 400), (304, 640)], .8)
guide([(112, 335), (250, 310), (390, 292), (520, 268)], .8)
guide([(118, 436), (300, 430), (490, 424)], .8)
guide([(120, 488), (300, 480), (480, 470)], .7)
for i in range(2):
    pts = [(305 + 172 * math.cos(t) * (1 + .01 * R.random()), 335 + 262 * math.sin(t) * (1 + .01 * R.random())) for t in [x * .35 - .3 + i * .2 for x in range(20)]]
    guide(pts, .8)
guide([(170, 244), (230, 205), (330, 192), (420, 228)], .7)           # forehead plane
guide([(122, 300), (150, 360), (150, 440)], .7)

# ================= glasses =================
FR_L_OUT = [(133, 305), (136, 336), (143, 370), (153, 388), (172, 403), (198, 405), (232, 400), (262, 389), (280, 378), (286, 355), (288, 330), (288, 308)]
FR_L_IN = [(158, 313), (161, 342), (168, 370), (178, 385), (198, 395), (222, 390), (248, 380), (266, 368), (274, 350), (278, 332), (278, 316)]
FR_R_OUT = [(322, 292), (324, 322), (332, 350), (343, 368), (362, 383), (392, 391), (422, 387), (446, 376), (458, 360), (463, 330), (465, 280)]
FR_R_IN = [(340, 311), (343, 336), (349, 356), (360, 368), (380, 378), (408, 380), (430, 373), (445, 358), (450, 335), (450, 300)]
TOP = [(133, 304), (190, 298), (240, 294), (286, 292), (300, 291), (322, 291), (370, 286), (420, 282), (465, 279)]
line(TOP, 1.25); line([(134, 312), (190, 306), (240, 302), (287, 300)], .7, .6); line([(322, 300), (370, 295), (420, 291), (465, 288)], .7, .6)
line(FR_L_OUT, 1.25, extra=' data-pass="2"'); line(FR_L_IN, .85)
line(FR_R_OUT, 1.25, extra=' data-pass="2"'); line(FR_R_IN, .85)
line([(158, 313), (200, 309), (245, 308), (278, 316)], .85); line([(340, 311), (380, 303), (420, 299), (450, 299)], .85)
line([(280, 316), (294, 324), (310, 323), (322, 312), (338, 310)], .9); line([(286, 296), (298, 306), (312, 305), (324, 296)], 1)
add("ball", '<circle cx="274" cy="297" r="2.2"/>'.replace('<circle cx="274" cy="297" r="2.2"/>', "M271.8 297 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0"), .9)
add("ball", "M321.8 292 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0", .9)
# frame (carbon weave): dense short hatching in the rim
hatch("3b", poly(TOP + [(465, 288), (420, 291), (370, 295), (322, 300), (287, 300), (240, 302), (190, 306), (134, 312)]).replace(" Z", " Z"), "-60 2.2", .5)
hatch("3b", poly(FR_L_OUT) + " " + poly(FR_L_IN), "-60 2.2", .5, True)
hatch("3b", poly(FR_R_OUT) + " " + poly(FR_R_IN), "-60 2.2", .5, True)
# lenses: dark brown, with the pale reflection left open in the left lens
hatch("3b", poly([(160, 314), (200, 311), (245, 310), (277, 318), (272, 336), (262, 342), (230, 336), (196, 340), (168, 352)]), "-38 2.4 cross", .5)
hatch("3b", poly(FR_R_IN), "-38 2.4 cross", .5)
hatch("3b", poly([(168, 354), (200, 342), (236, 338), (262, 344), (256, 360), (230, 372), (196, 386)]), "-38 3.4", .24)
line([(170, 372), (200, 356), (232, 346), (262, 342)], .7, .7); line([(180, 384), (214, 366), (250, 356)], .6, .6)   # pavement edges in the lens
line([(352, 316), (372, 312), (392, 312)], .6, .6)
guide([(176, 322), (206, 318)], .8); guide([(356, 322), (392, 313)], .8)

# ================= brows =================
for k, (x0, y0, x1, y1, bend) in enumerate([(176, 298, 276, 284, -22), (181, 293, 270, 279, -22), (186, 290, 262, 276, -20), (180, 302, 268, 287, -18)]):
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2 + bend
    line([(x0, y0), (mx - 20, my + 4), (mx + 24, my + 2), (x1, y1)], 1.15)
for k, (x0, y0, x1, y1, bend) in enumerate([(327, 286, 428, 275, -20), (332, 281, 422, 270, -21), (340, 278, 414, 267, -19), (330, 291, 426, 281, -17)]):
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2 + bend
    line([(x0, y0), (mx - 26, my + 3), (mx + 22, my - 2), (x1, y1)], 1.15)
hatch("3b", poly([(176, 298), (195, 283), (230, 274), (264, 277), (276, 286), (250, 285), (215, 289), (180, 304)]), "-12 1.9", .55)
hatch("3b", poly([(327, 287), (345, 271), (372, 261), (402, 261), (426, 272), (428, 277), (400, 272), (372, 277), (335, 292)]), "-12 1.9", .55)
for i in range(16):      # individual hairs flicking up out of the brows
    x = R.uniform(180, 272); y = 296 - (x - 180) * .12 - R.uniform(4, 22)
    line([(x, y + 8), (x + 3, y)], .5, .8)
for i in range(16):
    x = R.uniform(332, 424); y = 288 - (x - 332) * .12 - R.uniform(2, 24)
    line([(x, y + 8), (x + 3, y)], .5, .8)

# ================= nose =================
line([(290, 322), (286, 345), (282, 366), (277, 382)], .75, .7)
line([(322, 336), (330, 360), (344, 382), (356, 400)], .8, .7)
line([(277, 400), (268, 410), (264, 420), (270, 426), (282, 426), (291, 421)], 1)      # left wing
line([(358, 402), (363, 412), (361, 421), (352, 425), (342, 425), (334, 421)], 1)      # right wing
line([(291, 424), (302, 430), (318, 430), (334, 422)], .8, .8)
for ptsx in ([(270, 421), (279, 417), (289, 421)], [(335, 421), (343, 417), (352, 421)]):
    line(ptsx, 1.1)
hatch("3b", poly([(270, 419), (280, 415), (291, 421), (282, 426), (272, 425)]), "30 1.6", .6)
hatch("3b", poly([(334, 420), (344, 416), (354, 421), (346, 426), (336, 425)]), "30 1.6", .6)
hatch("3b", poly([(322, 346), (336, 372), (350, 392), (358, 404), (346, 400), (330, 390), (320, 368)]), "72 2.4", .3)
hatch("3b", poly([(266, 424), (280, 430), (302, 436), (330, 432), (340, 424), (318, 432), (290, 430)]), "10 2", .3)
guide([(262, 398), (258, 414), (262, 424)], .7); guide([(358, 404), (366, 414)], .7)

# ================= mouth =================
line([(244, 483), (264, 479), (284, 482), (300, 481), (325, 481), (352, 475), (378, 467)], 1.2)
line([(247, 474), (266, 466), (283, 459), (300, 459), (324, 458), (352, 462), (378, 467)], .8, .8)
line([(258, 492), (276, 505), (300, 509), (324, 504), (348, 494), (370, 477)], 1)
line([(386, 460), (392, 472), (390, 486), (381, 497)], .8, .7); line([(232, 468), (227, 479), (232, 490), (243, 496)], .7, .6)
hatch("3b", poly([(262, 500), (284, 510), (312, 512), (338, 504), (326, 520), (298, 524), (272, 516)]), "8 2.2", .3)

# ================= beard / mustache =================
BEARD = [(144, 422), (149, 440), (150, 497), (168, 560), (202, 605), (243, 633), (299, 645), (345, 640), (373, 631), (422, 597), (455, 552), (468, 497), (470, 440), (462, 425), (430, 448), (395, 452), (362, 446), (335, 430), (285, 432), (260, 440), (238, 450), (205, 446), (172, 438)]
LIPS = [(240, 481), (262, 467), (300, 458), (340, 462), (382, 466), (374, 480), (350, 498), (305, 510), (262, 500)]
MUST = [(232, 452), (262, 436), (300, 429), (340, 432), (372, 448), (398, 462), (382, 466), (340, 462), (300, 458), (262, 467), (240, 481)]
def edist(p, pg):
    best = 1e9
    for i in range(len(pg)):
        (x1, y1), (x2, y2) = pg[i], pg[(i + 1) % len(pg)]
        dx, dy = x2 - x1, y2 - y1; l2 = dx * dx + dy * dy or 1
        t = max(0, min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2))
        best = min(best, math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy))
    return best
OUTL = [(144, 422), (149, 440), (150, 497), (168, 560), (202, 605), (243, 633), (299, 645), (345, 640), (373, 631), (422, 597), (455, 552), (468, 497), (470, 440)]
# tone: dense on the jaw edge and mustache, thin on the cheeks, open under the lip
inset = [(305 + (x - 305) * .78, 470 + (y - 470) * .8) for x, y in OUTL] + [(470, 440), (144, 422)][::-1]
hatch("3b", poly(OUTL + [(462, 425), (150, 425)]) + " " + poly([(305 + (x - 305) * .8, 440 + (y - 440) * .74) for x, y in OUTL] + [(440, 440), (170, 440)][::-1]), "74 2.4", .2, True)
hatch("3b", poly(MUST), "70 1.7", .55)
hatch("3b", poly([(262, 510), (300, 520), (342, 510), (330, 526), (298, 532), (270, 526)]), "10 2.4", .22)
for i in range(1800):
    x, y = R.uniform(145, 470), R.uniform(425, 645)
    if not inside((x, y), BEARD) or inside((x, y), LIPS): continue
    d = edist((x, y), OUTL) if y > 440 else 99
    dens = max(0, 1 - d / 80) * .8 + .22
    if inside((x, y), MUST): dens = .95
    elif 505 < y < 545 and 250 < x < 360: dens *= .3
    if R.random() > dens * .85: continue
    lean = (x - 305) / 170
    ang = math.radians(90 + 42 * lean + R.uniform(-16, 16))
    l = R.uniform(4, 10) * (1.3 if d < 25 else 1)
    line([(x, y), (x + math.cos(ang) * l * .5, y + math.sin(ang) * l * .5), (x + math.cos(ang) * l, y + math.sin(ang) * l)], .8, R.uniform(.6, .95))
for i in range(len(OUTL) - 1):      # whiskery edge
    (x0, y0), (x1, y1) = OUTL[i], OUTL[i + 1]
    n = max(3, int(math.hypot(x1 - x0, y1 - y0) / 6))
    for j in range(n):
        f = (j + R.random()) / n; x, y = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
        nx, ny = (y1 - y0), -(x1 - x0); nl = math.hypot(nx, ny) or 1; nx, ny = nx / nl, ny / nl
        if (x - 305) * nx + (y - 500) * ny < 0: nx, ny = -nx, -ny
        line([(x - nx * 6, y - ny * 6), (x + nx * R.uniform(1, 4), y + ny * R.uniform(1, 4))], .45, .85)
line(OUTL, .85, .7, ' data-pass="2"')
for i in range(34):                 # mustache hairs, parted at the centre
    f = R.random(); x = 236 + f * 160; y = 440 + math.sin(f * math.pi) * -6 + 6
    d = (-1 if f < .5 else 1) * R.uniform(.3, .9)
    line([(x, y), (x + d * 6, y + 7), (x + d * 11, y + 14)], .5, .85)

# ================= ears, jaw, sideburns =================
line([(143, 380), (131, 377), (124, 390), (125, 412), (131, 432), (146, 449)], 1)
line([(135, 392), (131, 402), (133, 420), (141, 433)], .7, .7)
line([(466, 346), (480, 346), (488, 366), (485, 392), (474, 420), (464, 428)], 1)
line([(474, 362), (481, 376), (479, 394), (472, 408)], .7, .7)
line([(143, 372), (146, 400), (150, 440)], .9); line([(466, 350), (469, 400), (468, 440)], .9)
hatch("3b", poly([(146, 372), (160, 388), (168, 410), (150, 440)]), "80 2.6", .3)
hatch("3b", poly([(430, 382), (452, 398), (464, 420), (466, 440), (444, 424), (430, 404)]), "76 2.8", .28)
hatch("3b", poly([(150, 394), (172, 412), (200, 420), (230, 412), (205, 428), (172, 428), (152, 412)]), "28 3", .2)
hatch("3b", poly([(346, 376), (380, 396), (420, 392), (450, 376), (430, 404), (384, 410), (350, 392)]), "-26 3", .2)

# ================= hair =================
def pl(pts, t):
    seg = [math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]) for i in range(len(pts)-1)]
    tot = sum(seg); d = t * tot
    for i, s in enumerate(seg):
        if d <= s or i == len(seg) - 1:
            f = min(1, d / s); return (pts[i][0] + (pts[i+1][0]-pts[i][0]) * f, pts[i][1] + (pts[i+1][1]-pts[i][1]) * f)
        d -= s
HL = [(150, 360), (156, 322), (172, 292), (176, 250), (183, 209), (200, 188), (224, 175), (262, 167), (299, 164), (338, 168), (373, 175), (400, 190), (422, 209), (437, 235), (448, 262), (456, 300)]
OH = [(128, 360), (122, 318), (118, 262), (118, 239), (127, 194), (157, 157), (209, 127), (261, 97), (317, 69), (358, 86), (396, 123), (433, 168), (459, 224), (470, 269), (470, 304)]
HAIR = OH + HL[::-1]
hatch("3b", poly(HAIR), "64 3.0", .36)
hatch("3b", poly(HAIR), "-28 3.4", .22)
line(HL, 1.05, .9)
for i in range(70):          # ragged outer edge: short tufts thrown outward
    t = i / 69; a = pl(HL, t); b = pl(OH, t); vx, vy = b[0]-a[0], b[1]-a[1]; vl = math.hypot(vx, vy) or 1
    o = R.uniform(-5, 10); L = R.uniform(10, 24)
    p0 = (b[0] - vx/vl*L*.6 + R.uniform(-2, 2), b[1] - vy/vl*L*.6); p2 = (b[0] + vx/vl*o + R.uniform(-3, 3), b[1] + vy/vl*o)
    line([p0, ((p0[0]+p2[0])/2 + R.uniform(-3, 3), (p0[1]+p2[1])/2), p2], R.uniform(.9, 1.3), .95)
for i in range(96):          # strands grouped into clumps: shared sweep, own wave
    t = max(0, min(1, (i + R.uniform(-.3, .3)) / 95))
    a = pl(HL, t); b = pl(OH, t)
    vx, vy = b[0] - a[0], b[1] - a[1]
    clump = math.sin(t * 11 + 1) * 8
    ph = R.uniform(0, 6.28); am = R.uniform(1.5, 6)
    ext = R.uniform(.92, 1.08) if R.random() < .7 else R.uniform(1.1, 1.35)
    sw = (1 - abs(t - .5)) * 9 * (1 if t < .55 else -.7)
    pts = [(a[0] + vx * s_ * ext + (clump + sw) * math.sin(s_ * math.pi) + am * math.sin(s_ * 5 + ph), a[1] + vy * s_ * ext + am * .5 * math.cos(s_ * 4 + ph)) for s_ in (0, .2, .4, .6, .8, 1)]
    line(pts, R.uniform(.95, 1.35), R.uniform(.8, 1))
for i in range(60):          # short strands in the body of the mass for density
    t = R.random(); a = pl(HL, t); b = pl(OH, t); s0 = R.uniform(.15, .6); s1 = s0 + R.uniform(.25, .4)
    vx, vy = b[0] - a[0], b[1] - a[1]
    line([(a[0] + vx * s0, a[1] + vy * s0), (a[0] + vx * (s0 + s1) / 2 + R.uniform(-2, 2), a[1] + vy * (s0 + s1) / 2), (a[0] + vx * s1 + R.uniform(-2, 2), a[1] + vy * s1)], .9, .85)
for (x, y, a0, s, sp) in [(119, 215, 3.1, 20, .6), (126, 176, 2.5, 22, .6), (170, 148, 2.1, 26, .6), (250, 100, 1.9, 22, .5), (300, 60, -1.2, 26, -.5), (336, 70, -.9, 20, -.5), (382, 104, -.4, 18, -.5), (440, 190, -.1, 16, -.5), (133, 200, 2.6, 24, .5), (148, 165, 2.2, 22, .5), (120, 250, 3.0, 18, .5), (312, 66, -1.4, 22, -.5), (352, 82, -.6, 18, -.5), (402, 128, -.2, 16, -.5), (186, 140, 2.0, 20, .5), (228, 112, 1.9, 18, .5)]:
    pts = [(x, y)]
    for k in range(1, 7):
        a = a0 + sp * k * .5; pts.append((pts[-1][0] + math.cos(a) * s / 6 * 1.7, pts[-1][1] + math.sin(a) * s / 6 * 1.7))
    line(pts, .6, .85)

# ================= glasses detail, face =================
for k in range(15):              # carbon weave on the rim: tight diagonal ticks
    x = 140 + k * 22.5; line([(x, 300 - k * .9), (x + 7, 311 - k * .9)], .5, .7)
for k in range(11):
    x = 330 + k * 12.5; line([(x, 292 - k * .55), (x + 5, 300 - k * .55)], .5, .7)
for k in range(13):              # left lens: pavement reflection, diagonal stripes toward lower-left
    y0 = 340 + k * 4.2
    line([(172 + k * 2, y0 + 20 - k * .6), (232 + k * 2.5, y0 - 8 - k * .4)], .45, .75)
hatch("3b", poly([(182, 316), (200, 312), (232, 316), (250, 326), (236, 336), (206, 334), (184, 330)]), "-20 2.4", .55)    # dark shape in the reflection
hatch("3b", poly([(350, 318), (372, 312), (392, 318), (390, 336), (372, 346), (352, 340)]), "70 2", .5)               # silhouette in the right lens
hatch("3b", poly([(176, 402), (232, 404), (268, 388), (262, 400), (230, 412), (186, 412)]), "20 3", .24)             # cast shadow under the rim
hatch("3b", poly([(344, 384), (390, 392), (440, 384), (430, 396), (390, 404), (350, 396)]), "-16 3", .24)
line([(262, 428), (248, 448), (238, 470)], .75, .6); line([(352, 424), (372, 440), (388, 462)], .75, .6)             # smile creases
line([(256, 432), (244, 452), (234, 474)], .5, .5)
hatch("3b", poly([(284, 380), (296, 384), (300, 410), (290, 420), (280, 414)]), "80 2.4", .28)                      # shadow side of nose
hatch("3b", poly([(300, 428), (320, 432), (340, 428), (320, 440), (302, 438)]), "5 2.2", .3)                          # under the tip
line([(214, 216), (260, 208), (320, 206), (382, 212)], .5, .45); line([(206, 232), (262, 224), (330, 222)], .45, .35)   # forehead creases
line([(180, 266), (176, 300)], .5, .5); line([(450, 268), (452, 296)], .5, .5)
for i in range(70):              # pores / freckles
    x, y = R.uniform(170, 450), R.uniform(190, 440)
    if inside((x, y), BEARD) or (140 < x < 465 and 296 < y < 404): continue
    if y < 260 and not (190 < x < 430): continue
    line([(x, y), (x + R.uniform(-.8, .8), y + .9)], .45, .6)

# ================= neck + shirt =================
NECK = [(196, 600), (214, 640), (230, 668), (299, 690), (372, 668), (392, 640), (404, 596)]
hatch("3b", poly([(206, 625), (299, 650), (396, 622), (392, 645), (372, 668), (299, 690), (230, 668), (212, 645)]), "76 2.8", .2)
hatch("3b", poly([(214, 628), (299, 652), (390, 626), (388, 640), (299, 668), (216, 642)]), "-24 2.2", .26)           # shadow the beard throws on the neck
line([(196, 604), (198, 636), (210, 662), (232, 682)], .9, .8); line([(404, 598), (402, 632), (390, 658), (368, 680)], .9, .8)   # neck sides into the collar
line([(150, 747), (156, 712), (172, 680), (196, 656), (222, 676), (260, 700), (299, 710), (340, 702), (380, 680), (404, 656), (430, 682), (452, 712), (466, 747)], 1.15, .95)   # tee neckline
line([(204, 668), (232, 690), (268, 710), (299, 718), (334, 712), (372, 694), (398, 668)], .75, .7)   # ribbed collar edge
for k in range(18):          # rib ticks
    t = k / 17; x = 214 + t * 176; y = 676 + 44 * math.sin(t * math.pi) * .98
    line([(x, y - 1), (x - 2, y + 5)], .45, .6)
hatch("3b", poly([(150, 747), (156, 712), (172, 680), (196, 656), (200, 700), (190, 747)]), "-70 3.2", .22)      # shirt folds at the shoulders
hatch("3b", poly([(466, 747), (452, 712), (430, 682), (404, 656), (404, 700), (420, 747)]), "-70 3.2", .22)
line([(172, 740), (186, 716), (200, 706)], .6, .55); line([(450, 738), (432, 716), (414, 706)], .6, .55)

parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 747">',
         '<g data-pen="9h">' + "".join(out["9h"]) + "</g>",
         '<g data-pen="3b">' + "".join(out["3b"]) + "</g>",
         '<g data-pen="ballpoint">' + "".join(out["ball"]) + "</g>", "</svg>"]
open(sys.argv[1] if len(sys.argv) > 1 else "public/illos/self.svg", "w").write("\n".join(parts))
print(sum(len(v) for v in out.values()), "elements,", sum(len(p) for p in parts), "bytes")

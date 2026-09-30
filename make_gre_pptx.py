"""
Creates a polished English GRE-MRI presentation from video frames.
Design: Dark navy / cyan medical-imaging palette, split-layout slides.
"""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from lxml import etree
import copy, os

# ── Paths ──────────────────────────────────────────────────────────────────
FRAMES = r"C:\Users\neuro\Desktop\Proyect\gre_frames"
OUT    = r"C:\Users\neuro\Desktop\Proyect\GRE_MRI_Enhanced.pptx"

def fp(name): return os.path.join(FRAMES, name)

# ── Palette ────────────────────────────────────────────────────────────────
NAV  = RGBColor(0x0D, 0x1B, 0x2A)   # deep navy – background
CAR  = RGBColor(0x15, 0x2A, 0x41)   # card navy
CYA  = RGBColor(0x00, 0xB4, 0xD8)   # cyan accent
ICE  = RGBColor(0x90, 0xE0, 0xEF)   # ice blue – sub-headers
WHI  = RGBColor(0xFF, 0xFF, 0xFF)   # white
GRY  = RGBColor(0x8A, 0xA8, 0xBF)   # muted blue-grey
GRN  = RGBColor(0x06, 0xD6, 0xA0)   # mint green – highlights
YEL  = RGBColor(0xFF, 0xD1, 0x66)   # amber – callout boxes

# ── Slide dimensions (LAYOUT_WIDE 13.33" × 7.5") ──────────────────────────
W = Inches(13.33)
H = Inches(7.5)

prs = Presentation()
prs.slide_width  = W
prs.slide_height = H
blank = prs.slide_layouts[6]   # completely blank

# ── Helpers ────────────────────────────────────────────────────────────────
def rgb(r): return r   # passthrough (already RGBColor)

def bg(slide, color=NAV):
    s = slide.shapes.add_shape(1, 0, 0, W, H)
    s.fill.solid(); s.fill.fore_color.rgb = color
    s.line.fill.background()
    return s

def rect(slide, x, y, w, h, fill, line=None, radius=False):
    shtype = 5 if radius else 1   # ROUNDED_RECTANGLE=5, RECTANGLE=1
    s = slide.shapes.add_shape(shtype, x, y, w, h)
    s.fill.solid(); s.fill.fore_color.rgb = fill
    if line:
        s.line.color.rgb = line; s.line.width = Pt(1.5)
    else:
        s.line.fill.background()
    return s

def txt(slide, text, x, y, w, h, size=14, bold=False, italic=False,
        color=WHI, align=PP_ALIGN.LEFT, valign="top", wrap=True, margin=Inches(0.1)):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame; tf.word_wrap = wrap
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = margin
    p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = text
    r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
    r.font.color.rgb = color
    return tb

def mtxt(slide, items, x, y, w, h, valign="top", wrap=True, margin=Inches(0.1)):
    """Multi-run textbox. items = list of (text, size, bold, italic, color, align, breakLine)"""
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame; tf.word_wrap = wrap
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = margin
    first = True
    for (text, size, bold, italic, color, align, br) in items:
        if first:
            p = tf.paragraphs[0]; first = False
        else:
            p = tf.add_paragraph()
        p.alignment = align
        r = p.add_run(); r.text = text
        r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
        r.font.color.rgb = color
    return tb

def img(slide, path, x, y, w, h):
    if os.path.exists(path):
        slide.shapes.add_picture(path, x, y, w, h)

def dot(slide, label, x, y, color=CYA, size=13):
    """Bullet dot + label in a single line."""
    d = rect(slide, x, y+Inches(0.06), Inches(0.12), Inches(0.12), color)
    txt(slide, label, x+Inches(0.2), y, Inches(5), Inches(0.35),
        size=size, color=WHI)

def section_label(slide, text, x=Inches(0.5), y=Inches(0.22)):
    txt(slide, text.upper(), x, y, Inches(6), Inches(0.3),
        size=10, bold=True, color=CYA, margin=0)

def title_bar(slide, title, subtitle=None):
    txt(slide, title, Inches(0.5), Inches(0.55), Inches(12.3), Inches(0.65),
        size=30, bold=True, color=WHI, margin=0)
    if subtitle:
        txt(slide, subtitle, Inches(0.5), Inches(1.25), Inches(12.3), Inches(0.4),
            size=15, color=ICE, margin=0)

def callout_box(slide, text, x, y, w, h, bg_color=CAR, border=CYA, tsize=12):
    rect(slide, x, y, w, h, bg_color, line=border, radius=True)
    txt(slide, text, x+Inches(0.15), y+Inches(0.12),
        w-Inches(0.3), h-Inches(0.25), size=tsize, color=WHI, wrap=True)

def key_value(slide, key, value, x, y, kcolor=CYA, vcolor=WHI, size=13):
    txt(slide, key + "  ", x, y, Inches(2.2), Inches(0.38),
        size=size, bold=True, color=kcolor, align=PP_ALIGN.RIGHT, margin=0)
    txt(slide, value, x+Inches(2.25), y, Inches(5), Inches(0.38),
        size=size, color=vcolor, margin=0)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 1 — TITLE
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)

# Large teal glow circle (decorative)
circ = s.shapes.add_shape(9, Inches(8.5), Inches(-1.5), Inches(8), Inches(8))
circ.fill.solid(); circ.fill.fore_color.rgb = RGBColor(0x02, 0x3E, 0x58)
circ.line.fill.background()

# Cyan horizontal rule
rect(s, Inches(0.5), Inches(2.8), Inches(5.5), Inches(0.04), CYA)

txt(s, "MY FIRST", Inches(0.5), Inches(1.3), Inches(7), Inches(0.7),
    size=22, bold=False, color=ICE, margin=0)
txt(s, "Cartesian GRE in MRI", Inches(0.5), Inches(1.95), Inches(9), Inches(0.85),
    size=38, bold=True, color=WHI, margin=0)
txt(s, "Gradient Echo Sequence — Principles, k-Space & Implementation",
    Inches(0.5), Inches(3.05), Inches(9), Inches(0.5),
    size=16, color=GRY, margin=0)
txt(s, "Based on lecture by Belén Bravo Kunz · Enhanced English version",
    Inches(0.5), Inches(3.65), Inches(9), Inches(0.4),
    size=12, italic=True, color=GRY, margin=0)

# Bottom tag pills
for i,(label,col) in enumerate([
    ("Flip Angle",CYA),("Slice Selection",GRN),("k-Space",YEL),("Pre-Gradients",ICE)]):
    rx = Inches(0.5 + i*2.6); ry = Inches(6.6)
    rect(s, rx, ry, Inches(2.3), Inches(0.45), CAR, line=col, radius=True)
    txt(s, label, rx, ry+Inches(0.05), Inches(2.3), Inches(0.4),
        size=12, bold=True, color=col, align=PP_ALIGN.CENTER, margin=0)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 2 — GRE OVERVIEW  (frame_0002)
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "Introduction")
title_bar(s, "What is a Gradient Echo (GRE)?",
          "A fast MRI sequence using a single RF pulse and gradient reversal to form an echo")

# Image – left
img(s, fp("frame_0002_0137s.jpg"), Inches(0.4), Inches(1.85), Inches(5.8), Inches(4.8))

# Right panel
rx = Inches(6.6); pw = Inches(6.3)
txt(s, "GRE vs. Spin Echo", rx, Inches(1.85), pw, Inches(0.45),
    size=17, bold=True, color=CYA, margin=0)

bullets = [
    ("No 180° refocusing pulse — uses gradient reversal instead", GRN),
    ("Shorter TR/TE → faster acquisitions", WHI),
    ("Sensitive to T2* (not T2) — susceptibility effects visible", WHI),
    ("Flip angle < 90° preserves longitudinal magnetization", YEL),
]
for i,(text,col) in enumerate(bullets):
    dot(s, text, rx, Inches(2.45)+Inches(0.52)*i, color=col, size=13)

txt(s, "Key Parameters to Define", rx, Inches(4.65), pw, Inches(0.4),
    size=15, bold=True, color=ICE, margin=0)

params = [
    ("Flip Angle (FA)", "Tip angle of magnetization — trade-off between SNR & T1 contrast"),
    ("Excitation Time",  "Duration of RF pulse — shorter → wider bandwidth"),
    ("Frequency",        "42.6 MHz/T × B₀ (Larmor frequency)"),
    ("Shape",            "Sinc pulse → uniform slice excitation"),
]
for i,(k,v) in enumerate(params):
    key_value(s, k, v, rx-Inches(0.3), Inches(5.15)+Inches(0.44)*i, size=12)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 3 — RF PULSE PARAMETERS  (frame_0005)
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "RF Excitation Pulse")
title_bar(s, "Pulse A — RF Excitation Parameters",
          "Defining the sinc pulse that creates slice-selective excitation")

img(s, fp("frame_0005_0240s.jpg"), Inches(0.4), Inches(1.85), Inches(5.8), Inches(4.8))

rx = Inches(6.6); pw = Inches(6.3)
txt(s, "Optimal Choices", rx, Inches(1.85), pw, Inches(0.4),
    size=17, bold=True, color=CYA, margin=0)

choices = [
    ("FA → 90°",      "Maximizes transverse magnetization → maximum signal"),
    ("Duration → short", "Short pulse = wide bandwidth = better slice definition"),
    ("f = 42.6 MHz/T · B₀", "Larmor frequency; scales with field strength"),
    ("Shape = Sinc",  "Rectangular profile in frequency → uniform slice excitation"),
]
for i,(k,v) in enumerate(choices):
    rect(s, rx, Inches(2.4)+Inches(1.08)*i, pw, Inches(0.95), CAR, line=CYA, radius=True)
    txt(s, k, rx+Inches(0.15), Inches(2.5)+Inches(1.08)*i, pw-Inches(0.3), Inches(0.4),
        size=14, bold=True, color=CYA, margin=0)
    txt(s, v, rx+Inches(0.15), Inches(2.85)+Inches(1.08)*i, pw-Inches(0.3), Inches(0.45),
        size=12, color=GRY, margin=0)

callout_box(s, "Pulse A = excitation AND slice selection in one step",
            rx, Inches(6.75), pw, Inches(0.5), bg_color=RGBColor(0x04,0x3A,0x1C), border=GRN, tsize=12)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 4 — Gz SLICE SELECTION GRADIENT  (frame_0009)
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "Slice Selection Gradient")
title_bar(s, "Gz — Slice-Selection Gradient",
          "Applied simultaneously with the RF pulse to select a single slice")

img(s, fp("frame_0009_0338s.jpg"), Inches(0.4), Inches(1.85), Inches(5.8), Inches(4.8))

rx = Inches(6.6); pw = Inches(6.3)
txt(s, "Gz Waveform Structure", rx, Inches(1.85), pw, Inches(0.4),
    size=17, bold=True, color=CYA, margin=0)

wf = [
    ("GS  (Anz)",      "Slice-selection lobe — active during RF pulse"),
    ("A/2  (GTP)",     "Rephasing lobe — restores phase coherence after excitation"),
]
for i,(k,v) in enumerate(wf):
    key_value(s, k, v, rx-Inches(0.3), Inches(2.45)+Inches(0.5)*i, size=13)

txt(s, "mr.makeSincPulse( )", rx, Inches(3.65), pw, Inches(0.4),
    size=15, bold=True, color=YEL, margin=0)

code_lines = [
    "FA          — flip angle in radians",
    "Lims        — hardware limits (slew rate, max amplitude)",
    "'Duration'  — pulse duration in seconds (e.g. 3e-3 = 3 ms)",
    "'SliceThickness' — slice thickness in metres (e.g. 10e-3 = 10 mm)",
    "'Apodization'    — 0.5 → Hanning window (reduces side-lobes)",
    "'timeBwProduct'  — time–bandwidth product controls slice profile",
]
for i,line in enumerate(code_lines):
    txt(s, "  " + line, rx, Inches(4.2)+Inches(0.38)*i, pw, Inches(0.38),
        size=11, color=ICE if i==0 else GRY, margin=0,
        italic=(i>0))

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 5 — k-SPACE AFTER RF PULSE  (frame_0022)
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "k-Space — First Look")
title_bar(s, "Where Are We in k-Space After the RF Pulse?",
          "The 90° RF pulse positions the readout cursor at the center of k-space")

img(s, fp("frame_0022_0719s.jpg"), Inches(0.4), Inches(1.85), Inches(5.8), Inches(4.8))

rx = Inches(6.6); pw = Inches(6.3)
txt(s, "Effect on k-Space Position", rx, Inches(1.85), pw, Inches(0.4),
    size=17, bold=True, color=CYA, margin=0)

effects = [
    (CYA, "RF 90° pulse", "Sets current k-space position to the CENTER (kx=0, ky=0)"),
    (GRN, "Gz gradient",  "Provides SLICE SELECTION — confines excitation to one plane"),
    (YEL, "Goal",         "Move from center to the CORNER of k-space before readout"),
]
for i,(col,k,v) in enumerate(effects):
    rect(s, rx, Inches(2.45)+Inches(1.18)*i, pw, Inches(1.0), CAR, line=col, radius=True)
    txt(s, k, rx+Inches(0.18), Inches(2.55)+Inches(1.18)*i, pw-Inches(0.35), Inches(0.38),
        size=14, bold=True, color=col, margin=0)
    txt(s, v, rx+Inches(0.18), Inches(2.9)+Inches(1.18)*i, pw-Inches(0.35), Inches(0.45),
        size=12, color=GRY, margin=0)

callout_box(s, "Slice selection and k-space center happen at the same moment — efficient!",
            rx, Inches(6.0), pw, Inches(0.55), bg_color=RGBColor(0x04,0x3A,0x1C), border=GRN, tsize=12)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 6 — FOV AND SPATIAL RESOLUTION  (frame_0036)
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "k-Space Fundamentals")
title_bar(s, "Field of View & Spatial Resolution",
          "The image lives in real space; we sample it via k-space (Fourier domain)")

img(s, fp("frame_0036_1450s.jpg"), Inches(0.4), Inches(1.85), Inches(5.8), Inches(4.8))

rx = Inches(6.6); pw = Inches(6.3)
txt(s, "Key Relationships", rx, Inches(1.85), pw, Inches(0.4),
    size=17, bold=True, color=CYA, margin=0)

rels = [
    ("FOV",         "Field of View — size of the imaged region (mm × mm)"),
    ("Resolution",  "Pixel size (mm × mm) — spatial resolution of the image"),
    ("# of points", "FOV ÷ Resolution → number of k-space samples needed"),
]
for i,(k,v) in enumerate(rels):
    key_value(s, k, v, rx-Inches(0.3), Inches(2.45)+Inches(0.55)*i, size=13)

# example box
rect(s, rx, Inches(4.15), pw, Inches(1.3), CAR, line=YEL, radius=True)
txt(s, "Worked Example", rx+Inches(0.18), Inches(4.25), pw, Inches(0.35),
    size=13, bold=True, color=YEL, margin=0)
txt(s, "FOV = 25.6 cm,   Resolution = 2 mm × 2 mm",
    rx+Inches(0.18), Inches(4.62), pw-Inches(0.35), Inches(0.32),
    size=12, color=WHI, margin=0)
txt(s, "→  256 mm ÷ 2 mm = 128 sample points per dimension",
    rx+Inches(0.18), Inches(4.97), pw-Inches(0.35), Inches(0.35),
    size=12, bold=True, color=GRN, margin=0)

txt(s, "NUT = 1  (Number of Transients — single acquisition per line)",
    rx, Inches(5.65), pw, Inches(0.35), size=12, color=ICE, margin=0)
txt(s, "Sampling occurs in k-space (Fourier space), not image space directly.",
    rx, Inches(6.1), pw, Inches(0.5), size=12, italic=True, color=GRY, margin=0)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 7 — k-SPACE RESOLUTION  (frame_0042)
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "k-Space Resolution")
title_bar(s, "Defining k-Space Resolution (Δk)",
          "The spacing between k-space samples determines the FOV in image space")

img(s, fp("frame_0042_1592s.jpg"), Inches(0.4), Inches(1.85), Inches(5.8), Inches(4.8))

rx = Inches(6.6); pw = Inches(6.3)
txt(s, "k-Space Sampling Parameters", rx, Inches(1.85), pw, Inches(0.4),
    size=17, bold=True, color=CYA, margin=0)

kparams = [
    ("Δk  (or u)", "k-space resolution — spacing between adjacent samples"),
    ("N = 128",    "Number of points (same in frequency & phase directions)"),
    ("T = 2 mm",   "Sampling period in image space = Resolution"),
    ("Δk = 1/FOV", "Reciprocal relationship: smaller Δk → larger FOV"),
]
for i,(k,v) in enumerate(kparams):
    key_value(s, k, v, rx-Inches(0.3), Inches(2.45)+Inches(0.52)*i, size=13)

txt(s, "Duality Principle", rx, Inches(4.7), pw, Inches(0.4),
    size=15, bold=True, color=ICE, margin=0)

dual = [
    "• Total k-space extent (k_width) → controls RESOLUTION",
    "• k-space step size (Δk) → controls FOV",
    "• More k-space points → same FOV, better resolution",
]
for i,line in enumerate(dual):
    txt(s, line, rx, Inches(5.18)+Inches(0.42)*i, pw, Inches(0.4),
        size=12, color=GRY if i>0 else WHI, margin=0)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 8 — PRE-GRADIENTS CONCEPT  (frame_0053)
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "Pre-Gradients")
title_bar(s, "Pre-Gradients — Moving to the k-Space Corner",
          "Before readout, we need to position the k-space cursor at (-kwidth/2, -kwidth/2)")

img(s, fp("frame_0053_1870s.jpg"), Inches(0.4), Inches(1.85), Inches(5.8), Inches(4.8))

rx = Inches(6.6); pw = Inches(6.3)
txt(s, "Why Pre-Gradients?", rx, Inches(1.85), pw, Inches(0.4),
    size=17, bold=True, color=CYA, margin=0)

why = [
    "After the RF pulse we are at k = (0, 0) — k-space center.",
    "Readout must start at the edge: kx = −kwidth/2",
    "Pre-gradients move the cursor to the starting corner before the ADC opens.",
    "⚠  ADC is OFF during pre-gradients (hardware constraint).",
]
for i,line in enumerate(why):
    col = YEL if i==3 else (ICE if i==0 else WHI)
    txt(s, line, rx, Inches(2.45)+Inches(0.5)*i, pw, Inches(0.48),
        size=12, color=col, margin=0)

txt(s, "k = Area Under the Gradient", rx, Inches(4.65), pw, Inches(0.4),
    size=15, bold=True, color=ICE, margin=0)
txt(s, "K (m⁻¹) = γ / 2π · ∫G(t) dt  =  gradient AREA",
    rx, Inches(5.1), pw, Inches(0.4), size=13, bold=True, color=CYA, margin=0)

txt(s, "Goal: very short pre-gradients → all pre-grads must have equal duration",
    rx, Inches(5.65), pw, Inches(0.55), size=12, italic=True, color=GRY, margin=0)
txt(s, "→ Relevant: sample k-space CENTER (highest SNR) first → short TE",
    rx, Inches(6.22), pw, Inches(0.4), size=12, color=GRN, margin=0)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 9 — Gx PRE-GRADIENT  (frame_0055)
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "Pre-Gradients — Frequency Direction")
title_bar(s, "Gx Pre-Gradient (Frequency Encoding)",
          "Identical for every k-space line — positions readout to kx = −kwidth/2")

img(s, fp("frame_0055_2076s.jpg"), Inches(0.4), Inches(1.85), Inches(5.8), Inches(4.8))

rx = Inches(6.6); pw = Inches(6.3)
txt(s, "Gx Pre — Same for All Lines", rx, Inches(1.85), pw, Inches(0.4),
    size=17, bold=True, color=CYA, margin=0)

gxp = [
    ("Area",       "−kwidth/2  ±  Δk/2"),
    ("Duration",   "Pre time ≈ 2 ms  (can be shorter with stronger gradients)"),
    ("Polarity",   "Negative → moves kx to the LEFT edge of k-space"),
    ("Varies?",    "NO — same waveform repeated for every phase-encode line"),
]
for i,(k,v) in enumerate(gxp):
    key_value(s, k, v, rx-Inches(0.3), Inches(2.45)+Inches(0.52)*i, size=13)

callout_box(s,
    "Gx_pre = mr.makeTrapezoid('x', lims,\n"
    "   'Area', kwidth/2 − Δk/2,\n"
    "   'Duration', pre_time)",
    rx, Inches(4.65), pw, Inches(1.15),
    bg_color=RGBColor(0x04,0x22,0x38), border=CYA, tsize=12)

txt(s, "Note: want even number of sample points → include ±Δk/2 correction",
    rx, Inches(5.95), pw, Inches(0.5), size=11, italic=True, color=GRY, margin=0)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 10 — Gy PRE-GRADIENT + READOUT  (frame_0087)
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "Pre-Gradients — Phase Direction & Readout")
title_bar(s, "Gy Pre-Gradient & Readout Gradient",
          "Gy changes each line (phase encoding); Gx readout collects all kx points")

img(s, fp("frame_0087_2544s.jpg"), Inches(0.4), Inches(1.85), Inches(5.8), Inches(4.8))

rx = Inches(6.6); pw = Inches(6.3)
txt(s, "Gy Pre — Changes Every Line", rx, Inches(1.85), pw, Inches(0.4),
    size=17, bold=True, color=CYA, margin=0)

gyp = [
    ("Area",    "−(kwidth/2) + Line · Δk    (Line = 0 … N−1)"),
    ("Varies?", "YES — different for each TR repetition"),
    ("Purpose", "Steps ky from bottom to top of k-space, one line per TR"),
]
for i,(k,v) in enumerate(gyp):
    key_value(s, k, v, rx-Inches(0.3), Inches(2.4)+Inches(0.52)*i, size=13)

callout_box(s,
    "Gy_pre = mr.makeTrapezoid('y', Lims, …)\n"
    "termino = mr.addBlock(Gy_pre, Gx_pre)",
    rx, Inches(3.7), pw, Inches(0.9),
    bg_color=RGBColor(0x04,0x22,0x38), border=GRN, tsize=12)

txt(s, "Readout Gradient (Gx)", rx, Inches(4.8), pw, Inches(0.4),
    size=15, bold=True, color=YEL, margin=0)
ro = [
    ("No Gy during readout",  "We do NOT move in ky during readout — fixed line"),
    ("Gx duration",           "= ADC readout window duration"),
    ("Gx flat area",          "= kwidth  (covers the full kx extent)"),
    ("ADC ON",                "Samples all N kx points during the flat top"),
]
for i,(k,v) in enumerate(ro):
    key_value(s, k, v, rx-Inches(0.3), Inches(5.3)+Inches(0.45)*i, size=12)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 11 — TIMING DIAGRAM SUMMARY
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
section_label(s, "Summary")
title_bar(s, "GRE Sequence — Full Timing Overview",
          "Each TR block: RF + Gz → Pre-grads → Readout (Gx ADC) → repeat for all ky lines")

# Timeline bar
tl_y = Inches(2.6); tl_h = Inches(0.5)
segments = [
    (Inches(0.5),  Inches(2.1), "RF + Gz",      CYA,   "Excitation\n+ Slice\nSelect"),
    (Inches(2.65), Inches(2.2), "Gx Pre\nGy Pre", GRN,  "Position\nk-space\ncursor"),
    (Inches(4.9),  Inches(4.0), "ADC ON\n(Readout Gx)", YEL, "Collect\nall kx\npoints"),
    (Inches(8.95), Inches(3.8), "Wait / Gy\nReset",   ICE,  "T1 recovery\nReset phase"),
]
for i,(x,w,label,col,desc) in enumerate(segments):
    rect(s, x, tl_y, w, tl_h, col, radius=True)
    txt(s, label, x, tl_y+Inches(0.06), w, tl_h-Inches(0.12),
        size=11, bold=True, color=NAV, align=PP_ALIGN.CENTER, margin=0)
    txt(s, desc, x, tl_y+tl_h+Inches(0.12), w, Inches(0.65),
        size=10, color=col, align=PP_ALIGN.CENTER, margin=0)

# Arrow
rect(s, Inches(0.5), tl_y+Inches(0.22), Inches(12.5), Inches(0.06), GRY)

# Time labels
txt(s, "t = 0", Inches(0.5), tl_y+Inches(0.7), Inches(1), Inches(0.35),
    size=10, color=GRY, margin=0)
txt(s, "TE", Inches(6.8), tl_y+Inches(0.7), Inches(0.8), Inches(0.35),
    size=10, color=YEL, bold=True, margin=0)
txt(s, "TR", Inches(12.5), tl_y+Inches(0.7), Inches(0.7), Inches(0.35),
    size=10, color=GRY, margin=0)

# Key points grid
grid = [
    ("TR",       "Repetition Time — time between successive RF pulses"),
    ("TE",       "Echo Time — from RF center to k-space center readout"),
    ("Flip Angle","< 90° for short TR (Ernst angle optimizes SNR)"),
    ("k-space",  "Filled line-by-line; N lines = N TR repetitions"),
    ("Scan time","TR × N_lines × NUT  (e.g. 100ms × 128 × 1 = 12.8 s)"),
    ("T2* decay","Signal decays during readout → limits resolution"),
]
for i,(k,v) in enumerate(grid):
    col_x = Inches(0.5 if i%2==0 else 6.9)
    row_y = Inches(4.2) + Inches(0.7) * (i//2)
    rect(s, col_x, row_y, Inches(5.9), Inches(0.58), CAR, line=CYA if i%2==0 else GRN, radius=True)
    txt(s, k, col_x+Inches(0.15), row_y+Inches(0.05), Inches(1.5), Inches(0.48),
        size=12, bold=True, color=CYA if i%2==0 else GRN, margin=0)
    txt(s, v, col_x+Inches(1.5), row_y+Inches(0.1), Inches(4.2), Inches(0.4),
        size=11, color=WHI, margin=0)

# ══════════════════════════════════════════════════════════════════════════
# SLIDE 12 — FINAL SLIDE
# ══════════════════════════════════════════════════════════════════════════
s = prs.slides.add_slide(blank); bg(s)
circ2 = s.shapes.add_shape(9, Inches(7), Inches(-1), Inches(7.5), Inches(7.5))
circ2.fill.solid(); circ2.fill.fore_color.rgb = RGBColor(0x02, 0x3E, 0x58)
circ2.line.fill.background()

rect(s, Inches(0.5), Inches(3.15), Inches(5.5), Inches(0.04), CYA)
txt(s, "FROM PULSE TO IMAGE", Inches(0.5), Inches(1.3), Inches(8), Inches(0.6),
    size=18, color=ICE, margin=0)
txt(s, "You now have a complete\nCartesian GRE sequence",
    Inches(0.5), Inches(2.0), Inches(9), Inches(1.1),
    size=34, bold=True, color=WHI, margin=0)

steps = [
    ("1", "Define RF sinc pulse (FA, duration, frequency, shape)", CYA),
    ("2", "Apply Gz for slice selection simultaneously", GRN),
    ("3", "Compute k-space parameters (FOV, Δk, N)", YEL),
    ("4", "Apply Gx_pre & Gy_pre to reach k-space corner", ICE),
    ("5", "Readout with Gx — ADC collects N samples per line", GRN),
    ("6", "Repeat N times (one per ky line) → full k-space", CYA),
]
for i,(num,text,col) in enumerate(steps):
    ry = Inches(3.4) + Inches(0.62)*i
    rect(s, Inches(0.5), ry, Inches(0.45), Inches(0.45), col, radius=True)
    txt(s, num, Inches(0.5), ry, Inches(0.45), Inches(0.45),
        size=14, bold=True, color=NAV, align=PP_ALIGN.CENTER, margin=0)
    txt(s, text, Inches(1.05), ry+Inches(0.05), Inches(5.5), Inches(0.38),
        size=12, color=WHI, margin=0)

txt(s, "Belén Bravo Kunz · Enhanced English lecture",
    Inches(0.5), Inches(7.05), Inches(9), Inches(0.3),
    size=10, italic=True, color=GRY, margin=0)

# ══════════════════════════════════════════════════════════════════════════
prs.save(OUT)
print(f"Saved: {OUT}")
print(f"Slides: {len(prs.slides)}")

import cv2
import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
import numpy as np

VIDEO_PATH = r"C:\Users\neuro\AppData\Local\Temp\MyFirstGRE (1).mp4"
OUTPUT_DIR = r"C:\Users\neuro\Desktop\Proyect\gre_frames"
PPTX_PATH = r"C:\Users\neuro\Desktop\Proyect\GRE_MRI.pptx"

os.makedirs(OUTPUT_DIR, exist_ok=True)

cap = cv2.VideoCapture(VIDEO_PATH)
fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
duration = total_frames / fps
print(f"Video: {duration:.1f}s, {fps:.1f} fps, {total_frames} frames")

# Extract 1 frame per second, skip duplicates using frame difference
def is_significantly_different(frame1, frame2, threshold=8):
    if frame1 is None:
        return True
    diff = cv2.absdiff(
        cv2.resize(frame1, (160, 90)),
        cv2.resize(frame2, (160, 90))
    )
    return diff.mean() > threshold

saved_frames = []
last_saved = None
frame_interval = int(fps)  # 1 frame per second

frame_idx = 0
saved_count = 0
cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

while True:
    ret, frame = cap.read()
    if not ret:
        break
    if frame_idx % frame_interval == 0:
        if is_significantly_different(last_saved, frame):
            path = os.path.join(OUTPUT_DIR, f"frame_{saved_count:04d}_{int(frame_idx/fps):04d}s.jpg")
            cv2.imwrite(path, frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            saved_frames.append(path)
            last_saved = frame.copy()
            saved_count += 1
    frame_idx += 1

cap.release()
print(f"Extracted {saved_count} unique frames")

# Build PowerPoint
prs = Presentation()
prs.slide_width = Inches(13.33)
prs.slide_height = Inches(7.5)

DARK_BG = RGBColor(0x0D, 0x1B, 0x2A)
ACCENT   = RGBColor(0x00, 0xB4, 0xD8)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
GRAY     = RGBColor(0xAA, 0xBB, 0xCC)

blank_layout = prs.slide_layouts[6]

def add_bg(slide):
    bg = slide.shapes.add_shape(1, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid()
    bg.fill.fore_color.rgb = DARK_BG
    bg.line.fill.background()

# Title slide
slide = prs.slides.add_slide(blank_layout)
add_bg(slide)
# Accent bar
bar = slide.shapes.add_shape(1, 0, Inches(3.2), prs.slide_width, Inches(0.06))
bar.fill.solid(); bar.fill.fore_color.rgb = ACCENT; bar.line.fill.background()

txb = slide.shapes.add_textbox(Inches(1), Inches(2.0), Inches(11.33), Inches(1.2))
tf = txb.text_frame; tf.word_wrap = False
p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
run = p.add_run(); run.text = "Gradient Echo (GRE) in MRI"
run.font.size = Pt(40); run.font.bold = True; run.font.color.rgb = WHITE

txb2 = slide.shapes.add_textbox(Inches(1), Inches(3.5), Inches(11.33), Inches(0.7))
tf2 = txb2.text_frame
p2 = tf2.paragraphs[0]; p2.alignment = PP_ALIGN.CENTER
run2 = p2.add_run(); run2.text = "Principles, Sequences & Clinical Applications"
run2.font.size = Pt(20); run2.font.color.rgb = ACCENT

txb3 = slide.shapes.add_textbox(Inches(1), Inches(4.4), Inches(11.33), Inches(0.5))
tf3 = txb3.text_frame
p3 = tf3.paragraphs[0]; p3.alignment = PP_ALIGN.CENTER
run3 = p3.add_run(); run3.text = "Based on original Spanish lecture · Enhanced English version"
run3.font.size = Pt(14); run3.font.color.rgb = GRAY

# One slide per frame
for i, img_path in enumerate(saved_frames):
    slide = prs.slides.add_slide(blank_layout)
    add_bg(slide)

    # Top label
    txb = slide.shapes.add_textbox(Inches(0.2), Inches(0.1), Inches(3), Inches(0.35))
    tf = txb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = f"Frame {i+1} / {len(saved_frames)}"
    run.font.size = Pt(10); run.font.color.rgb = GRAY

    # Image — fill most of slide
    img_h = Inches(6.6)
    img_w = Inches(11.7)
    left = (prs.slide_width - img_w) // 2
    top = Inches(0.55)
    try:
        slide.shapes.add_picture(img_path, left, top, img_w, img_h)
    except Exception as e:
        print(f"  Skipping {img_path}: {e}")

prs.save(PPTX_PATH)
print(f"Saved: {PPTX_PATH}")

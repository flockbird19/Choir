"""
Choir pitch-video outro — logo mark draws itself from the center, then the
wordmark fades in.

Geometry pulled directly from frontend/src/components/Logo.tsx (8 lines +
dot "voices" radiating from one point) and colors from globals.css's dark
theme tokens, so this matches the real brand instead of guessing.

Render:
    pip install manim
    manim -pqh choir_outro.py ChoirOutro      # quick preview, opens when done
    manim -pqk choir_outro.py ChoirOutro      # final 4K render

Needs the Newsreader font installed system-wide for the wordmark to look
right (falls back to a generic serif otherwise): https://fonts.google.com/specimen/Newsreader
"""

from manim import *

BG = "#0A0B10"
NAVY = "#7FA8E0"
FG = "#F5F6F8"

config.background_color = BG

# (dx, dy, stroke_width) for each of the 8 lines, taken from Logo.tsx's
# <line> coordinates relative to its center (110,110), scaled to fit the
# Manim frame and with y flipped (SVG y grows down, Manim y grows up).
RAYS = [
    (2.05, 0.33, 3.0),   # the one thicker "primary voice" line
    (1.65, 1.55, 1.8),
    (0.55, 2.15, 1.8),
    (-1.20, 2.25, 1.8),
    (-2.20, 1.60, 1.8),
    (-2.15, -0.55, 1.8),
    (-1.00, -2.15, 1.8),
    (0.90, -1.80, 1.8),
]


class ChoirOutro(Scene):
    def construct(self):
        center = Dot(ORIGIN, radius=0.045, color=NAVY)

        lines = []
        dots = []
        for dx, dy, sw in RAYS:
            end = np.array([dx, dy, 0])
            line = Line(ORIGIN, end, stroke_width=sw, color=NAVY, stroke_opacity=0.9)
            dot = Dot(end, radius=0.09, color=NAVY)
            lines.append(line)
            dots.append(dot)

        # Radiate outward: each voice draws its line then pops its dot,
        # staggered so the mark builds like a ripple, not all at once.
        self.play(FadeIn(center, scale=0.5), run_time=0.3)
        self.play(
            LaggedStart(
                *[
                    Succession(
                        Create(line, run_time=0.35),
                        GrowFromCenter(dot, run_time=0.2),
                    )
                    for line, dot in zip(lines, dots)
                ],
                lag_ratio=0.12,
            )
        )

        mark = VGroup(center, *lines, *dots)

        # Settle: a soft pulse to give the finished mark some life before
        # the wordmark commits.
        self.play(mark.animate.scale(1.06), rate_func=there_and_back, run_time=0.5)

        # Pull the mark up to make room for the wordmark underneath.
        self.play(mark.animate.shift(UP * 1.1).scale(0.85), run_time=0.6)

        wordmark = Text("Choir", font="Newsreader", weight=MEDIUM, color=FG).scale(1.6)
        wordmark.next_to(mark, DOWN, buff=0.55)

        tagline = Text(
            "One team. One shared AI.",
            font="Hanken Grotesk",
            color=FG,
        ).scale(0.42)
        tagline.set_opacity(0.7)
        tagline.next_to(wordmark, DOWN, buff=0.35)

        self.play(FadeIn(wordmark, shift=UP * 0.2), run_time=0.6)
        self.play(FadeIn(tagline, shift=UP * 0.15), run_time=0.5)

        self.wait(1.2)

        self.play(
            FadeOut(VGroup(mark, wordmark, tagline)),
            run_time=0.6,
        )

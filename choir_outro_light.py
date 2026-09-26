"""
Choir pitch-video outro — LIGHT theme variant.

Same animation as choir_outro.py, just swapped to the light-theme tokens
from globals.css (--ds-bg / --ds-primary under :root, not the dark-mode
overrides): background #F7F7FA, navy mark #25508F.

Render:
    manim -pqh choir_outro_light.py ChoirOutroLight      # quick preview
    manim -pqk choir_outro_light.py ChoirOutroLight      # final 4K render
"""

from manim import *

BG = "#F7F7FA"
NAVY = "#25508F"
FG = "#14161C"

config.background_color = BG

RAYS = [
    (2.05, 0.33, 3.0),
    (1.65, 1.55, 1.8),
    (0.55, 2.15, 1.8),
    (-1.20, 2.25, 1.8),
    (-2.20, 1.60, 1.8),
    (-2.15, -0.55, 1.8),
    (-1.00, -2.15, 1.8),
    (0.90, -1.80, 1.8),
]


class ChoirOutroLight(Scene):
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

        self.play(mark.animate.scale(1.06), rate_func=there_and_back, run_time=0.5)
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

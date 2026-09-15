"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { IconButton } from "./IconButton";
import { useIsClient } from "./useMediaQuery";

/** Light/dark switch in the new design. */
export function ThemeSwitch({ size = "md" }: { size?: "sm" | "md" }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isClient = useIsClient();
  const isDark = isClient && resolvedTheme === "dark";

  return (
    <IconButton
      label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      icon={isDark ? <Sun /> : <Moon />}
      size={size}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    />
  );
}

import type { Metadata } from "next";
import { SolShiftGame } from "./game/SolShiftGame";

export const metadata: Metadata = {
  description:
    "A 60-second physics survival game. Capture matter, bend its orbit, and release a Nova as the laws of the arena mutate around you.",
};

export default function Home() {
  return <SolShiftGame />;
}

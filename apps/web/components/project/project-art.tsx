import type { CSSProperties } from "react";

const PALETTES = [
  ["#e5ead9", "#b9cb96", "#7a9362", "#f4f6ec"],
  ["#eee4d9", "#d2b89c", "#a68062", "#fbf3e9"],
  ["#e4e4ed", "#b5b4ce", "#83819f", "#f2f1f8"],
];

/** A schematic building illustration, not a photograph of the actual site. */
export function ProjectArt({ id, large = false }: { id: string; large?: boolean }) {
  const seed = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const palette = PALETTES[seed % PALETTES.length]!;
  const towers = seed % 2 === 0;
  return <div className={`project-art ${large ? "project-art-large" : ""}`} style={{ "--art-ground": palette[0], "--art-front": palette[1], "--art-side": palette[2], "--art-roof": palette[3] } as CSSProperties}>
    <span className="art-label">Concept illustration</span>
    <svg viewBox="0 0 420 220" fill="none" aria-hidden="true">
      <g stroke="currentColor" opacity=".12" strokeWidth=".6">
        {[40, 80, 120, 160, 200, 240, 280, 320, 360, 400].map((x) => <path key={x} d={`M${x - 140} 220L${x + 100} 80M${x - 80} 80L${x + 160} 220`} />)}
      </g>
      <ellipse cx="220" cy="176" rx="114" ry="23" fill="var(--art-side)" opacity=".13" />
      <g className="art-building">
        <path d="M116 108L211 61L306 108L211 156Z" fill="var(--art-roof)" />
        <path d="M116 108V157L211 205V156Z" fill="var(--art-front)" />
        <path d="M211 156V205L306 157V108Z" fill="var(--art-side)" />
        <path d="M127 103L211 23L295 103L211 145Z" fill="var(--art-roof)" />
        <path d="M127 103L211 23V145Z" fill="var(--art-front)" />
        <path d="M211 23L295 103L211 145Z" fill="var(--art-side)" opacity=".65" />
        {towers && <><path d="M240 65V30L256 22L273 30V82Z" fill="var(--art-side)" /><path d="M240 30L256 22L273 30L257 39Z" fill="var(--art-roof)" /></>}
        {[0, 1, 2].map((i) => <g key={i}><path d={`M${130 + i * 25} ${125 + i * 12}v18l14 7v-18Z`} fill="var(--art-roof)" opacity=".8" /><path d={`M${226 + i * 25} ${159 - i * 12}v18l14-7v-18Z`} fill="var(--art-roof)" opacity=".75" /></g>)}
        <path d="M186 165v27l15 8v-28Z" fill="var(--art-side)" />
        <path d="M116 158L211 205L306 157" stroke="var(--art-roof)" opacity=".65" />
      </g>
      <g fill="var(--art-side)"><path d="M83 159v25" stroke="var(--art-side)" strokeWidth="2" /><ellipse cx="83" cy="149" rx="12" ry="20" opacity=".7" /><path d="M330 142v25" stroke="var(--art-side)" strokeWidth="2" /><ellipse cx="330" cy="133" rx="10" ry="17" opacity=".5" /></g>
    </svg>
  </div>;
}

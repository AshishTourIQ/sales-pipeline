"use client";

import { guideFor, type GuideEntry } from "../../config/template";
import type { StageKey } from "../../types";
import { Section } from "../common";

export function GuideGrid({ g, labels = "drawer" }: { g: GuideEntry; labels?: "drawer" | "guide" }) {
  const h4 = "m-0 mb-1 text-xs font-semibold text-ink-2";
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-[22px] gap-y-3.5">
      {g.e && <div><h4 className={h4}>Enters when</h4><p className="m-0">{g.e}</p></div>}
      {g.x && <div><h4 className={h4}>Moves on when</h4><p className="m-0">{g.x}</p></div>}
      {g.h && <div><h4 className={h4}>{labels === "drawer" ? "You do" : "A person does"}</h4><ul className="m-0 pl-[18px]">{g.h.map((x) => <li key={x} className="my-[3px]">{x}</li>)}</ul></div>}
      {g.s && <div><h4 className={h4}>The pipeline does</h4><ul className="m-0 pl-[18px]">{g.s.map((x) => <li key={x} className="my-[3px]">{x}</li>)}</ul></div>}
      {g.a && <div><h4 className={h4}>Marketing asset</h4><p className="m-0">{g.a}</p></div>}
      {g.d && <div><h4 className={h4}>{labels === "drawer" ? "Capture" : "Data to capture"}</h4><p className="m-0">{g.d}</p></div>}
    </div>
  );
}

export function GuideTab({ stage, description }: { stage: StageKey; description?: string }) {
  return <Section><GuideGrid g={guideFor(stage, description)} /></Section>;
}

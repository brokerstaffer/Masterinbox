"use client";

import { createContext, useContext } from "react";
import {
  DEFAULT_STAGE_LABELS,
  type PipelineStage,
} from "@/lib/portals/portal-data";

// Per-client-resolved labels for the pipeline_stage enum. Provided
// once at the top of the pipeline UI tree (see
// [components/portals/pipeline-board.tsx]) and consumed by every
// nested component that renders a stage name — badges, dropdowns,
// the move-to menu, toast text. Pulling these via context instead
// of prop drilling keeps the 8 read sites tidy and means the
// editor's Save reflects everywhere in one re-render.

const StageLabelsContext = createContext<Record<PipelineStage, string>>(
  DEFAULT_STAGE_LABELS,
);

export function StageLabelsProvider({
  value,
  children,
}: {
  value: Record<PipelineStage, string>;
  children: React.ReactNode;
}) {
  return (
    <StageLabelsContext.Provider value={value}>
      {children}
    </StageLabelsContext.Provider>
  );
}

export function useStageLabels(): Record<PipelineStage, string> {
  return useContext(StageLabelsContext);
}

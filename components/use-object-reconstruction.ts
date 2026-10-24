"use client";
import { useEffect, useState } from "react";
import type { ObjectCloud } from "@/lib/spatial/object-reconstruction";

export type ShownCloud = ObjectCloud & { elementId: string; caption: string };

/** Load the rebuilt piece when one is selected. A missing cloud leaves the scan measurements in place. */
export function useObjectReconstruction(inspectionId: string, elementId: string | null) {
  const [cloud, setCloud] = useState<ShownCloud | null>(null), [reconstructing, setReconstructing] = useState(false);
  useEffect(() => {
    if (!inspectionId || !elementId) { setCloud(null); setReconstructing(false); return; }
    let active = true;
    const controller = new AbortController();
    setCloud(null); setReconstructing(true);
    fetch(`/api/inspections/${inspectionId}/spatial/objects/${encodeURIComponent(elementId)}`, { signal: controller.signal })
      .then(async response => response.ok ? response.json() as Promise<ShownCloud> : null)
      .then(body => { if (active) setCloud(body); })
      .catch(() => { if (active) setCloud(null); })
      .finally(() => { if (active) setReconstructing(false); });
    return () => { active = false; controller.abort(); };
  }, [inspectionId, elementId]);
  return { cloud, reconstructing };
}

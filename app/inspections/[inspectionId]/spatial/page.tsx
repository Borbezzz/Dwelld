import SpatialWorkspace from "@/components/spatial-workspace";
export default async function Page({ params }: { params: Promise<{ inspectionId: string }> }) { const { inspectionId } = await params; return <SpatialWorkspace inspectionId={inspectionId} />; }

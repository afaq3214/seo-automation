import { StrategyView } from "./strategy-view";

export default async function StrategyPage(props: PageProps<"/projects/[projectId]/strategy">) {
  const { projectId } = await props.params;
  return <StrategyView projectId={projectId} />;
}

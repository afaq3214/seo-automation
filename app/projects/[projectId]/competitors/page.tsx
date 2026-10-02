import { CompetitorsView } from "./competitors-view";

export default async function CompetitorsPage(props: PageProps<"/projects/[projectId]/competitors">) {
  const { projectId } = await props.params;
  return <CompetitorsView projectId={projectId} />;
}

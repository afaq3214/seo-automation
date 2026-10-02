import { KeywordsView } from "./keywords-view";

export default async function KeywordsPage(props: PageProps<"/projects/[projectId]/keywords">) {
  const { projectId } = await props.params;
  return <KeywordsView projectId={projectId} />;
}

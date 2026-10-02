import { PagesView } from "./pages-view";

export default async function PagesPage(props: PageProps<"/projects/[projectId]/pages">) {
  const { projectId } = await props.params;
  return <PagesView projectId={projectId} />;
}

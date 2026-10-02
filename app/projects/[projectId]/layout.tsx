import { notFound } from "next/navigation";
import { z } from "zod";
import { ProjectTabs } from "@/components/project-tabs";
import { Badge } from "@/components/ui";
import { getProject } from "@/lib/services/projects";

export default async function ProjectLayout(props: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await props.params;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const project = await getProject(projectId);
  if (!project) notFound();

  return (
    <div>
      <header className="border-b border-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{project.domain}</h1>
              <Badge tone="slate">
                {project.country} · {project.language}
              </Badge>
            </div>
            <a href={project.url} target="_blank" rel="noreferrer" className="text-sm text-slate-500 hover:text-indigo-600">
              {project.url} ↗
            </a>
          </div>
          {project.analysis && (
            <p className="max-w-md text-right text-sm text-slate-500">{project.analysis.businessType}</p>
          )}
        </div>
        <div className="mt-5">
          <ProjectTabs projectId={project.id} />
        </div>
      </header>
      <div className="pt-6">{props.children}</div>
    </div>
  );
}

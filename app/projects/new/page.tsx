import { NewProjectForm } from "@/components/new-project-form";
import { PageHeader } from "@/components/ui";

export default function NewProjectPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="New project" description="Start with a website URL, target country and language." />
      <NewProjectForm />
    </div>
  );
}

import { EmptyState } from "@/components/console/empty-state";

export default function ViewNotFound() {
  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">View not found</h1>
      </div>
      <EmptyState
        message="This view does not exist or has been deleted."
        action={{ label: "Back to views", href: "/views" }}
      />
    </>
  );
}

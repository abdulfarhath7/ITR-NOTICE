import { Card, CardBody } from "@/components/ui/card";
import { LogPane } from "@/features/sync/LogPane";
import { Pipeline } from "@/features/sync/Pipeline";
import { Viewport } from "@/features/sync/Viewport";

export function SyncPanel(): JSX.Element {
  return (
    <section aria-label="Sync" className="flex flex-col gap-3">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
          <Pipeline />
        </CardBody>
      </Card>

      {/* one column until there is room for the log beside the picture */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Viewport />
        <LogPane />
      </div>
    </section>
  );
}

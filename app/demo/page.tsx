import Masthead from "@/components/Masthead";
import DemoConsole from "@/components/DemoConsole";
import { TASKS } from "@/lib/env/tasks";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  return (
    <>
      <Masthead tagline="Execute agents live against the real model and the programmatic verifier. Every run is recorded in your own browser and feeds a dashboard that is generated from your session — model behavior and pod health build up live as each episode lands, not copied from the reference corpus." />
      <main className="wrap">
        <DemoConsole tasks={TASKS.map((t) => ({ id: t.id, title: t.title, difficulty: t.difficulty }))} />
      </main>
    </>
  );
}

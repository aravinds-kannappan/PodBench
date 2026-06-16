import Masthead from "@/components/Masthead";
import DemoConsole from "@/components/DemoConsole";
import { TASKS } from "@/lib/env/tasks";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  return (
    <>
      <Masthead tagline="Execute agents live against the real model and the programmatic verifier. Runs you do here are recorded in your own browser, so they appear instantly with accurate timestamps and build up your own KPIs and charts — independent of the shared reference corpus." />
      <main className="wrap">
        <DemoConsole tasks={TASKS.map((t) => ({ id: t.id, title: t.title, difficulty: t.difficulty }))} />
      </main>
    </>
  );
}

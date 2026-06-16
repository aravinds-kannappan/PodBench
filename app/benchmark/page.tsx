import Masthead from "@/components/Masthead";
import BenchmarkLab from "@/components/BenchmarkLab";
import { TASKS } from "@/lib/env/tasks";

export const dynamic = "force-dynamic";

export default function BenchmarkPage() {
  return (
    <>
      <Masthead tagline="Run the same deterministic environment head-to-head across models and trials, then read the efficiency frontier: the cheapest model that still clears your quality bar. Every run is live and metered; results also accumulate in your demo session." />
      <main className="wrap">
        <BenchmarkLab tasks={TASKS.map((t) => ({ id: t.id, title: t.title, difficulty: t.difficulty }))} />
      </main>
    </>
  );
}

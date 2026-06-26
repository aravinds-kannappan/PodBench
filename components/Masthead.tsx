import TabNav from "./TabNav";

export default function Masthead({ tagline }: { tagline?: string }) {
  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div>
            <div className="brand">
              <div className="logo">pb</div>
              <div>
                <h1>
                  podbench <span className="ver">v0.6.0</span>
                </h1>
              </div>
            </div>
            <p className="tagline">
              {tagline ??
                "Deterministic, resettable task environments for LLM agents with a programmatic verifier, run concurrently on Kubernetes with per-run token metering, rate-limit backoff, and prompt caching."}
            </p>
          </div>
          <nav className="masthead-links">
            <a href="https://github.com/aravinds-kannappan/PodBench">github</a>
          </nav>
        </div>
      </header>
      <TabNav />
    </>
  );
}

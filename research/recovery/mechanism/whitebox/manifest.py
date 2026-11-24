"""Record the actual local files and runtime used for the original-weight analysis."""
import argparse
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import platform
from contexts import HERE, RECOVERY
from fetch_weights import verify


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream,"sha256").hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights",type=Path,required=True)
    parser.add_argument("--qwen-cache",type=Path,required=True)
    parser.add_argument("--smol-cache",type=Path,required=True)
    args=parser.parse_args()
    models=json.loads((HERE/"weights.json").read_text())
    for key,spec in models.items():
        config=json.loads((args.weights/key/"config.json").read_text())
        spec["architecture"]={k:config[k] for k in ("model_type","hidden_size","num_hidden_layers",
                               "num_attention_heads","num_key_value_heads","vocab_size","torch_dtype")}
        template=json.loads((args.weights/key/"tokenizer_config.json").read_text())["chat_template"]
        spec["chat_template_sha256"]=hashlib.sha256(template.encode()).hexdigest()
        for name,entry in spec["files"].items():
            f=args.weights/key/name
            if not verify(f,entry):
                raise ValueError(f"Pinned upstream artifact changed: {f}")
            entry["sha256"]=digest(f)
    files=["contexts.py","features.py","original.py","readouts.py","collect.py","interventions.py","protocol.md",
           "fetch_weights.py","merge.py","weights.json","feature_archive.py","vocab_lens.py"]
    inputs={"journal":"../../episodes.jsonl","gguf_scores":"../scores-decisions.jsonl",
            "recovery_environment":"../../environment.py","recovery_driver":"../../run.py"}
    outputs={str(f.relative_to(HERE)):digest(f) for f in sorted((HERE/"records").glob("*/*")) if f.suffix in {".jsonl",".npz"}}
    outputs["results.json"]=digest(HERE/"results.json")
    result={
        "study":"Exploratory (not preregistered)","model_sources":models,
        "runtime":{"python":platform.python_version(),"system":platform.system(),"machine":platform.machine(),
                   "packages":{k:version(k) for k in ["torch","transformers","numpy","tokenizers","safetensors","huggingface_hub"]},
                   "torch_cpu_threads":1,"blas_threads":1,"attention":"eager","parameters_and_matmuls":"bfloat16",
                   "cpu_model":next((l.split(":",1)[1].strip() for l in Path("/proc/cpuinfo").read_text().splitlines()
                                     if l.startswith("model name")),None) if Path("/proc/cpuinfo").exists() else None},
        "settings":{"train_seeds":[11,23,37],"test_seed":53,"max_new_tokens":12,"episode_turn_limit":5,
                    "greedy":True,"decoding_seed":None,"decoding_note":"No token sampling; models in eval mode.",
                    "shuffle_seed_by_target":{"hidden_commit":41817,"inspected":41818,"correct_next_action":41819,"instruction":41820},
                    "ridge_penalty":1,"steering_coefficients":[-1,0,0.5,1,2],"direction_training_pairs_per_model":18,
                    "steering_blocks_one_indexed":{"qwen2.5-0.5b":12,"smollm2-360m":16}},
        "source_sha256":{n:digest(HERE/n) for n in files},
        "input_sha256":{k:{"path":p,"sha256":digest(HERE/p)} for k,p in inputs.items()},
        "output_sha256":outputs,
        "local_feature_caches":{"disposition":"Lossless decision-position residuals and row labels are published as numeric NPZ files in records/, excluded from website assets. Full PyTorch caches with other intermediate tensors and original weights remain external.",
                                "qwen2.5-0.5b":digest(args.qwen_cache),"smollm2-360m":digest(args.smol_cache)},
    }
    (HERE/"manifest.json").write_text(json.dumps(result,indent=2)+"\n")


if __name__=="__main__":
    main()

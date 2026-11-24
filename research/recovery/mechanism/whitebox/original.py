"""Transformers CPU inference, final-token activation capture, and local interventions."""
from contextlib import contextmanager
import json
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from contexts import HERE
from run import INSPECT_FIRST


@contextmanager
def hooks(registrations):
    handles = [module.register_forward_hook(fn) for module, fn in registrations]
    try:
        yield
    finally:
        for handle in handles:
            handle.remove()


def tensor_of(output):
    return output[0] if isinstance(output, tuple) else output


def change(vector, additive=False):
    def hook(module, inputs, output):
        hidden = tensor_of(output).clone()
        if additive:
            hidden[:, -1] += vector
        else:
            hidden[:, -1] = vector
        return (hidden, *output[1:]) if isinstance(output, tuple) else hidden
    return hook


class Original:
    def __init__(self, directory):
        self.tok = AutoTokenizer.from_pretrained(directory, local_files_only=True)
        self.model = AutoModelForCausalLM.from_pretrained(directory, torch_dtype=torch.bfloat16,
                        attn_implementation="eager", local_files_only=True).eval()
        self.base = self.model.model
        self.layers = self.base.layers
        self.head = self.model.lm_head
        end = self.model.generation_config.eos_token_id
        self.end = set(end if isinstance(end, list) else [end])
        self.block = len(self.layers)//2 - 1  # zero-based midpoint block

    def encode(self, messages):
        rendered = self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        encoded = self.tok(rendered, add_special_tokens=False, return_offsets_mapping=True)
        return torch.tensor([encoded["input_ids"]]), encoded["offset_mapping"], rendered

    def spans(self, messages, rendered, offsets):
        spans = {"system":[], "added_instruction":[], "observations":[]}
        pos = 0
        for m in messages:
            start = rendered.index(m["content"], pos)
            pos = start + len(m["content"])
            if m["role"] == "system":
                spans["system"].append((start, pos))
                if m["content"].endswith(INSPECT_FIRST):
                    spans["added_instruction"].append((pos-len(INSPECT_FIRST), pos))
            if m["role"] == "user" and m["content"].startswith("Tool result: "):
                end = m["content"].index("\nAction menu:")
                spans["observations"].append((start+len("Tool result: "), start+end))
        return {key:[i for i,(a,b) in enumerate(offsets) if any(a<y and b>x for x,y in ranges)]
                for key,ranges in spans.items()}

    def ids(self, menu):
        ids = [self.tok.encode(name, add_special_tokens=False)[0] for name in menu]
        if len(set(ids)) != len(ids):
            raise ValueError("Shared action-name initial token")
        return ids

    def modules(self):
        return [(layer, layer.self_attn, layer.mlp) for layer in self.layers]

    def capture(self, messages, menu, parts):
        ids, offsets, rendered = self.encode(messages)
        indices = self.spans(messages, rendered, offsets)
        residual, components, registrations = [], {"attention":[], "mlp":[]}, []
        def collect(dest):
            def hook(module, inputs, output):
                dest.append(tensor_of(output)[0,-1].detach().clone())
            return hook
        for layer, attn, mlp in self.modules():
            registrations.append((layer,collect(residual)))
            if parts:
                registrations.extend([(attn,collect(components["attention"])),(mlp,collect(components["mlp"]))])
        with hooks(registrations):
            out = self.base(ids, use_cache=False, output_attentions=True)
        residual = torch.stack(residual)
        logits = self.head(out.last_hidden_state[0,-1]).float()
        action_ids = self.ids(menu)
        # Match the model's final normalization and unembedding dtype at every layer.
        candidate = self.base.norm(residual) @ self.head.weight[action_ids].T
        masses = {}
        for span, positions in indices.items():
            if positions:
                masses[span] = {"fraction": len(positions)/ids.shape[-1],
                    "mass":[float(w[0,:,-1,positions].float().sum(-1).mean()) for w in out.attentions]}
        return {"residual":residual, "components":{k:torch.stack(v) for k,v in components.items() if v},
                "masses":masses, "candidates":candidate.float(), "input_tokens":ids.shape[-1],
                "inspect_id":action_ids[menu.index("inspect")],
                "inspect_p":float(logits.softmax(-1)[action_ids[menu.index("inspect")]]),
                "vocab_argmax":int(logits.argmax())}

    def cached_prefix(self, messages):
        ids = self.encode(messages)[0]
        out = self.base(ids[:,:-1], use_cache=True)
        return ids, out.past_key_values

    def forward_last(self, ids, cache, registration=()):
        length = ids.shape[-1]
        cache.crop(length-1)
        with hooks(registration):
            out = self.base(ids[:,-1:], past_key_values=cache, use_cache=True)
        return self.head(out.last_hidden_state[0,-1]).float()

    def decode(self, logits, cache):
        output = []
        for i in range(12):
            token = int(logits.argmax())
            if token in self.end:
                break
            output.append(token)
            if i < 11:
                out = self.base(torch.tensor([[token]]), past_key_values=cache, use_cache=True)
                logits = self.head(out.last_hidden_state[0,-1]).float()
        self.last_count = len(output)
        self.last_finish = "length" if len(output)==12 else "stop"
        return self.tok.decode(output, skip_special_tokens=False, clean_up_tokenization_spaces=False)

    def greedy(self, messages, steer=None):
        ids, cache = self.cached_prefix(messages)
        reg = [(self.layers[self.block],change(steer, True))] if steer is not None else []
        return self.decode(self.forward_last(ids,cache,reg), cache)

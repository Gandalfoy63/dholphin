// Docs: docs/04 - Architecture/Rust Core.md
//! Purpose: entry point of the core, and the one JSON call the page uses through WASM.
pub mod normalize;
pub mod rank;
pub mod search;
pub mod taste;
pub mod types;

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct Call {
    op: String,
    #[serde(default)]
    args: Value,
}

fn arg<T: serde::de::DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| format!("{key}: {e}"))
}

fn run(call: &Call) -> Result<Value, String> {
    let a = &call.args;
    let to = |v: Result<Value, serde_json::Error>| v.map_err(|e| e.to_string());
    match call.op.as_str() {
        "version" => Ok(json!(env!("CARGO_PKG_VERSION"))),
        "normalize_list" => to(serde_json::to_value(normalize::list(&arg::<Value>(a, "json")?, arg::<Option<String>>(a, "kind")?.as_deref()))),
        "normalize_details" => {
            let kind: String = arg(a, "kind")?;
            let region: String = arg(a, "region")?;
            to(serde_json::to_value(normalize::details(&arg::<Value>(a, "json")?, &kind, &region)))
        }
        "normalize_omdb" => to(serde_json::to_value(normalize::omdb(&arg::<Value>(a, "json")?))),
        "taste" => to(serde_json::to_value(taste::build(&arg::<Vec<types::Signal>>(a, "signals")?, &arg::<Vec<types::Title>>(a, "titles")?))),
        "rank" => {
            let t: types::Taste = arg(a, "taste")?;
            let c: Vec<types::Candidate> = arg(a, "candidates")?;
            let o: types::RankOptions = arg(a, "options")?;
            to(serde_json::to_value(rank::rank(&t, &c, &o)))
        }
        "affinity" => {
            let t: types::Taste = arg(a, "taste")?;
            to(serde_json::to_value(rank::affinity(&t, &arg::<Vec<types::Title>>(a, "titles")?)))
        }
        "search" => {
            let q: String = arg(a, "query")?;
            let t: types::Taste = arg(a, "taste")?;
            to(serde_json::to_value(search::rank(&q, &arg::<Vec<types::Title>>(a, "titles")?, &t)))
        }
        other => Err(format!("unknown op {other}")),
    }
}

/// Runs one call from JSON text. Never panics on bad input: errors come back as `{"error": ...}`.
pub fn call_json(input: &str) -> String {
    let out = match serde_json::from_str::<Call>(input) {
        Ok(c) => run(&c).map(|v| json!({ "ok": v })).unwrap_or_else(|e| json!({ "error": e })),
        Err(e) => json!({ "error": e.to_string() }),
    };
    out.to_string()
}

/// Reserves memory the page writes its input to.
#[no_mangle]
pub extern "C" fn dh_alloc(len: usize) -> *mut u8 {
    let mut b = Vec::<u8>::with_capacity(len.max(1));
    let p = b.as_mut_ptr();
    std::mem::forget(b);
    p
}

/// Gives back memory from `dh_alloc` or a `dh_call` result.
///
/// # Safety
/// `ptr` and `len` must come from `dh_alloc` or `dh_call`, once only.
#[no_mangle]
pub unsafe extern "C" fn dh_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

/// Takes ownership of the input and returns the answer as `(pointer << 32) | length`.
///
/// # Safety
/// `ptr` and `len` must describe bytes written after `dh_alloc(len)`.
#[no_mangle]
pub unsafe extern "C" fn dh_call(ptr: *mut u8, len: usize) -> u64 {
    let input = String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).into_owned();
    dh_free(ptr, len);
    let mut out = call_json(&input).into_bytes();
    out.shrink_to_fit();
    let (p, l) = (out.as_mut_ptr() as u64, out.len() as u64);
    std::mem::forget(out);
    (p << 32) | l
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bad_input_is_an_error_and_not_a_panic() {
        assert!(call_json("not json").contains("error"));
        assert!(call_json(r#"{"op":"nope"}"#).contains("unknown op"));
        assert!(call_json(r#"{"op":"rank","args":{}}"#).contains("error"));
    }

    #[test]
    fn version_answers() {
        assert!(call_json(r#"{"op":"version"}"#).contains(env!("CARGO_PKG_VERSION")));
    }
}

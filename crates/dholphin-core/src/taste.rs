// Docs: docs/03 - Features/Recommendations.md
//! Purpose: turns a profile's signals into a weighted taste vector.
use crate::types::{Signal, Taste, Title};
use std::collections::{BTreeMap, HashMap};

const WEIGHT_GENRE: f64 = 1.0;
const WEIGHT_KEYWORD: f64 = 1.2;
const WEIGHT_PERSON: f64 = 0.8;
const WEIGHT_DECADE: f64 = 0.4;
const WEIGHT_LANGUAGE: f64 = 0.5;
const WEIGHT_KIND: f64 = 0.3;
const HALF_LIFE_DAYS: f64 = 90.0;
const HALF_LIFE_RATING_DAYS: f64 = 365.0;

/// Weighted features of a title, as "g:Action", "k:heist", "p:Name", "d:1990", "l:fr", "m:movie".
pub fn features(t: &Title) -> Vec<(String, f64)> {
    let mut f = Vec::new();
    f.extend(t.genres.iter().map(|g| (format!("g:{g}"), WEIGHT_GENRE)));
    f.extend(t.keywords.iter().map(|k| (format!("k:{}", k.to_lowercase()), WEIGHT_KEYWORD)));
    f.extend(t.people.iter().chain(t.creators.iter()).map(|p| (format!("p:{p}"), WEIGHT_PERSON)));
    if let Some(y) = t.year {
        f.push((format!("d:{}", y / 10 * 10), WEIGHT_DECADE));
    }
    if !t.language.is_empty() {
        f.push((format!("l:{}", t.language), WEIGHT_LANGUAGE));
    }
    if !t.kind.is_empty() {
        f.push((format!("m:{}", t.kind), WEIGHT_KIND));
    }
    f
}

fn signal_weight(kind: &str) -> f64 {
    match kind {
        "love" => 3.0,
        "like" => 2.0,
        "finished" | "pick" => 1.5,
        "list" => 1.0,
        "watched" => 0.5,
        "abandoned" => -0.5,
        "dislike" => -3.0,
        _ => 0.0,
    }
}

fn decay(s: &Signal) -> f64 {
    let life = if matches!(s.kind.as_str(), "love" | "like" | "dislike") { HALF_LIFE_RATING_DAYS } else { HALF_LIFE_DAYS };
    0.5_f64.powf(s.age_days.max(0.0) / life)
}

/// Common features count for less: "Drama" says less about someone than "heist".
fn inverse_frequency(titles: &[Title]) -> HashMap<String, f64> {
    let mut seen: HashMap<String, u32> = HashMap::new();
    for t in titles {
        for (name, _) in features(t) {
            *seen.entry(name).or_default() += 1;
        }
    }
    let n = titles.len().max(1) as f64;
    seen.into_iter().map(|(k, c)| (k, ((1.0 + n) / (1.0 + f64::from(c))).ln() + 1.0)).collect()
}

/// Builds the taste vector. `titles` are the titles the signals refer to, plus any candidates, for frequency.
pub fn build(signals: &[Signal], titles: &[Title]) -> Taste {
    let idf = inverse_frequency(titles);
    let by_key: HashMap<&str, &Title> = titles.iter().map(|t| (t.key.as_str(), t)).collect();
    let mut sum: BTreeMap<String, f64> = BTreeMap::new();
    let mut per_title: HashMap<&str, f64> = HashMap::new();
    let mut disliked = Vec::new();
    for s in signals {
        let w = signal_weight(&s.kind) * decay(s);
        if s.kind == "dislike" {
            disliked.push(s.key.clone());
        }
        let Some(t) = by_key.get(s.key.as_str()) else { continue };
        *per_title.entry(t.key.as_str()).or_default() += w;
        for (name, fw) in features(t) {
            *sum.entry(name.clone()).or_default() += w * fw * idf.get(&name).copied().unwrap_or(1.0);
        }
    }
    let norm = sum.values().map(|v| v * v).sum::<f64>().sqrt();
    if norm > 0.0 {
        sum.values_mut().for_each(|v| *v /= norm);
    }
    let mut top: Vec<(&str, f64)> = per_title.into_iter().filter(|(_, w)| *w > 0.0).collect();
    top.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(b.0)));
    let liked = top.iter().take(10).filter_map(|(k, _)| by_key.get(k).map(|t| (t.key.clone(), t.name.clone()))).collect();
    Taste { features: sum, liked, disliked }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn title(key: &str, genres: &[&str]) -> Title {
        Title { key: key.into(), name: key.into(), genres: genres.iter().map(|g| g.to_string()).collect(), ..Default::default() }
    }

    fn sig(key: &str, kind: &str, age: f64) -> Signal {
        Signal { key: key.into(), kind: kind.into(), age_days: age }
    }

    #[test]
    fn likes_raise_a_feature_and_dislikes_lower_it() {
        let ts = [title("a", &["Thriller"]), title("b", &["Comedy"])];
        let t = build(&[sig("a", "like", 0.0), sig("b", "dislike", 0.0)], &ts);
        assert!(t.features["g:Thriller"] > 0.0);
        assert!(t.features["g:Comedy"] < 0.0);
        assert_eq!(t.disliked, vec!["b"]);
        assert!(t.liked.contains_key("a") && !t.liked.contains_key("b"));
    }

    #[test]
    fn old_signals_count_for_less() {
        let ts = [title("a", &["Thriller"]), title("b", &["Comedy"])];
        let t = build(&[sig("a", "finished", 0.0), sig("b", "finished", 360.0)], &ts);
        assert!(t.features["g:Thriller"] > t.features["g:Comedy"] * 10.0);
    }

    #[test]
    fn rare_features_outweigh_common_ones() {
        let mut ts = vec![title("x", &["Drama", "Heist"])];
        ts.extend((0..20).map(|i| title(&format!("d{i}"), &["Drama"])));
        let t = build(&[sig("x", "like", 0.0)], &ts);
        assert!(t.features["g:Heist"] > t.features["g:Drama"]);
    }

    #[test]
    fn no_signals_give_an_empty_taste() {
        assert!(build(&[], &[title("a", &["Drama"])]).features.is_empty());
    }
}

// Docs: docs/03 - Features/Recommendations.md
//! Purpose: scores candidates against a taste, then orders them for variety.
use crate::taste::features;
use crate::types::{Candidate, RankOptions, Scored, Taste, Title};
use std::collections::HashSet;

const W_TASTE: f64 = 0.50;
const W_QUALITY: f64 = 0.20;
const W_REACH: f64 = 0.15;
const W_FRESH: f64 = 0.10;
const W_POP: f64 = 0.05;
/// Bayesian prior: a score counts as this many average votes before its own votes count.
const PRIOR_VOTES: f64 = 500.0;
const PRIOR_MEAN: f64 = 6.8;

/// Cosine similarity with the taste vector, from -1 to 1.
pub fn taste_score(taste: &Taste, t: &Title) -> f64 {
    let f = features(t);
    let (mut dot, mut norm) = (0.0, 0.0);
    for (name, w) in &f {
        norm += w * w;
        if let Some(v) = taste.features.get(name) {
            dot += v * w;
        }
    }
    if norm == 0.0 { 0.0 } else { dot / norm.sqrt() }
}

/// 0 to 1, from whichever scores exist. Few votes pull a score toward the average.
pub fn quality(t: &Title) -> f64 {
    let s = &t.scores;
    let votes = f64::from(s.imdb_votes.unwrap_or(s.tmdb_votes));
    let raw = s.imdb.unwrap_or(s.tmdb);
    let mut bayes = (raw * votes + PRIOR_MEAN * PRIOR_VOTES) / (votes + PRIOR_VOTES);
    if raw == 0.0 {
        bayes = PRIOR_MEAN;
    }
    let mut parts = vec![bayes / 10.0];
    parts.extend(s.tomato.map(|v| v / 100.0));
    parts.extend(s.metacritic.map(|v| v / 100.0));
    parts.iter().sum::<f64>() / parts.len() as f64
}

fn base_score(taste: &Taste, c: &Candidate) -> f64 {
    let t = &c.title;
    let reach = (c.seeds.len() as f64 / 3.0).min(1.0);
    let fresh = if c.trending { 1.0 } else { 0.0 };
    let pop = (t.popularity.max(0.0) + 1.0).ln() / 8.0;
    let s = W_TASTE * taste_score(taste, t) + W_QUALITY * quality(t) + W_REACH * reach + W_FRESH * fresh + W_POP * pop.min(1.0);
    s * if c.available > 0.0 { c.available } else { 0.4 }
}

const A_TASTE: f64 = 0.70;
const A_QUALITY: f64 = 0.25;
const A_POP: f64 = 0.05;

/// How likely the profile is to like each title, 0 to 1: mostly how close it is to the taste, then how well it is
/// reviewed, a little how popular it is. Nothing about trends or availability: this orders a row by the profile alone.
/// A title the profile disliked scores 0. Keys come back in the given order.
pub fn affinity(taste: &Taste, titles: &[Title]) -> Vec<(String, f64)> {
    let disliked: HashSet<&str> = taste.disliked.iter().map(String::as_str).collect();
    titles
        .iter()
        .map(|t| {
            if disliked.contains(t.key.as_str()) {
                return (t.key.clone(), 0.0);
            }
            let close = (taste_score(taste, t).clamp(-1.0, 1.0) + 1.0) / 2.0;
            let pop = ((t.popularity.max(0.0) + 1.0).ln() / 8.0).min(1.0);
            (t.key.clone(), (A_TASTE * close + A_QUALITY * quality(t) + A_POP * pop).clamp(0.0, 1.0))
        })
        .collect()
}

fn feature_set(t: &Title) -> HashSet<String> {
    features(t).into_iter().map(|(n, _)| n).collect()
}

fn similarity(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    let union = a.union(b).count();
    if union == 0 { 0.0 } else { a.intersection(b).count() as f64 / union as f64 }
}

fn reason(taste: &Taste, c: &Candidate) -> String {
    if let Some(seed) = c.seeds.first() {
        return format!("Because you liked {seed}");
    }
    let best = c.title.genres.iter().filter_map(|g| taste.features.get(&format!("g:{g}")).map(|w| (g, *w))).filter(|(_, w)| *w > 0.0).max_by(|a, b| a.1.total_cmp(&b.1));
    match best {
        Some((g, _)) => format!("You often watch {g}"),
        None if c.trending => "Trending now".to_string(),
        None => "Well reviewed".to_string(),
    }
}

/// Scores, drops what must not appear, and picks in Maximal Marginal Relevance order.
pub fn rank(taste: &Taste, candidates: &[Candidate], o: &RankOptions) -> Vec<Scored> {
    let exclude: HashSet<&str> = o.exclude.iter().chain(taste.disliked.iter()).map(String::as_str).collect();
    let mut seen = HashSet::new();
    let mut pool: Vec<(usize, f64, HashSet<String>)> = candidates
        .iter()
        .enumerate()
        .filter(|(_, c)| !exclude.contains(c.title.key.as_str()) && seen.insert(c.title.key.clone()))
        .map(|(i, c)| (i, base_score(taste, c), feature_set(&c.title)))
        .collect();
    // A stable start: equal scores come out in a fixed order.
    pool.sort_by(|a, b| b.1.total_cmp(&a.1).then(candidates[a.0].title.key.cmp(&candidates[b.0].title.key)));

    let mut top_genres: Vec<(&String, f64)> = taste.features.iter().filter(|(k, v)| k.starts_with("g:") && **v > 0.0).map(|(k, v)| (k, *v)).collect();
    top_genres.sort_by(|a, b| b.1.total_cmp(&a.1));
    let top: HashSet<String> = top_genres.iter().take(3).map(|(k, _)| k.to_string()).collect();

    let mut out = Vec::new();
    let mut chosen: Vec<HashSet<String>> = Vec::new();
    while out.len() < o.limit && !pool.is_empty() {
        let slot = out.len() + 1;
        let explore = o.explore_every > 0 && slot % o.explore_every == 0 && !top.is_empty();
        let pick = if explore {
            pool.iter().position(|(_, _, f)| f.is_disjoint(&top)).unwrap_or(0)
        } else {
            let mut best = (0, f64::MIN);
            for (n, (_, s, f)) in pool.iter().enumerate() {
                let sim = chosen.iter().map(|c| similarity(f, c)).fold(0.0, f64::max);
                let mmr = o.lambda * s - (1.0 - o.lambda) * sim;
                if mmr > best.1 {
                    best = (n, mmr);
                }
            }
            best.0
        };
        let (i, s, f) = pool.remove(pick);
        chosen.push(f);
        let c = &candidates[i];
        out.push(Scored { key: c.title.key.clone(), score: s, reason: reason(taste, c) });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::taste::build;
    use crate::types::{Scores, Signal};

    fn t(key: &str, genres: &[&str], imdb: f64) -> Title {
        Title { key: key.into(), name: key.into(), kind: "movie".into(), genres: genres.iter().map(|g| g.to_string()).collect(), scores: Scores { imdb: Some(imdb), imdb_votes: Some(50000), ..Default::default() }, ..Default::default() }
    }

    fn c(title: Title) -> Candidate {
        Candidate { title, available: 1.0, ..Default::default() }
    }

    fn thriller_fan() -> (Taste, Vec<Candidate>) {
        let mut titles: Vec<Title> = (0..12).map(|i| t(&format!("th{i}"), &["Thriller", "Crime"], 7.5)).collect();
        titles.extend((0..12).map(|i| t(&format!("co{i}"), &["Comedy"], 7.5)));
        let signals: Vec<Signal> = (0..3).map(|i| Signal { key: format!("th{i}"), kind: "like".into(), age_days: 1.0 }).collect();
        let taste = build(&signals, &titles);
        (taste, titles.into_iter().map(c).collect())
    }

    #[test]
    fn affinity_puts_what_the_taste_likes_first_and_dislikes_last() {
        let (mut taste, cands) = thriller_fan();
        let titles: Vec<Title> = cands.into_iter().map(|c| c.title).collect();
        taste.disliked.push("th5".into());
        let a: std::collections::HashMap<String, f64> = affinity(&taste, &titles).into_iter().collect();
        assert!(a["th8"] > a["co3"], "a thriller beats a comedy for a thriller fan: {} vs {}", a["th8"], a["co3"]);
        assert_eq!(a["th5"], 0.0);
        assert!(a.values().all(|v| (0.0..=1.0).contains(v)));
    }

    #[test]
    fn affinity_without_taste_follows_reviews() {
        let titles = vec![t("low", &["Drama"], 5.0), t("high", &["Drama"], 8.5)];
        let a = affinity(&Taste::default(), &titles);
        assert!(a[1].1 > a[0].1);
    }

    #[test]
    fn a_thriller_fan_mostly_gets_thrillers() {
        let (taste, cands) = thriller_fan();
        let o = RankOptions { limit: 7, explore_every: 0, ..Default::default() };
        let r = rank(&taste, &cands, &o);
        let hits = r.iter().filter(|s| s.key.starts_with("th")).count();
        assert!(hits >= 5, "{r:?}");
    }

    #[test]
    fn a_dislike_removes_the_title() {
        let (mut taste, cands) = thriller_fan();
        taste.disliked.push("th5".into());
        let r = rank(&taste, &cands, &RankOptions { limit: 24, ..Default::default() });
        assert!(r.iter().all(|s| s.key != "th5"));
    }

    #[test]
    fn excluded_and_repeated_titles_do_not_appear() {
        let (taste, mut cands) = thriller_fan();
        cands.push(cands[0].clone());
        let r = rank(&taste, &cands, &RankOptions { limit: 30, exclude: vec!["th1".into()], ..Default::default() });
        assert!(r.iter().all(|s| s.key != "th1"));
        assert_eq!(r.iter().filter(|s| s.key == "th0").count(), 1);
    }

    #[test]
    fn exploration_reaches_outside_the_top_genres() {
        let (taste, cands) = thriller_fan();
        let r = rank(&taste, &cands, &RankOptions { limit: 8, explore_every: 8, ..Default::default() });
        assert!(r[7].key.starts_with("co"), "{r:?}");
    }

    #[test]
    fn availability_lowers_the_score() {
        let taste = Taste::default();
        let mut far = c(t("far", &["Drama"], 8.0));
        far.available = 0.4;
        let near = c(t("near", &["Drama"], 8.0));
        let r = rank(&taste, &[far, near], &RankOptions { limit: 2, explore_every: 0, ..Default::default() });
        assert_eq!(r[0].key, "near");
    }

    #[test]
    fn few_votes_pull_a_score_to_the_average() {
        let mut lucky = t("lucky", &["Drama"], 10.0);
        lucky.scores.imdb_votes = Some(3);
        assert!(quality(&lucky) < quality(&t("solid", &["Drama"], 8.5)));
    }

    #[test]
    fn a_seed_explains_the_suggestion() {
        let mut x = c(t("x", &["Drama"], 8.0));
        x.seeds = vec!["Dark".into()];
        let r = rank(&Taste::default(), &[x], &RankOptions::default());
        assert_eq!(r[0].reason, "Because you liked Dark");
    }

    #[test]
    fn varied_results_beat_near_copies() {
        let copies: Vec<Candidate> = (0..4).map(|i| c(t(&format!("same{i}"), &["Drama", "War"], 8.0))).collect();
        let mut all = copies;
        all.push(c(t("other", &["Comedy"], 7.9)));
        let r = rank(&Taste::default(), &all, &RankOptions { limit: 2, lambda: 0.3, explore_every: 0, ..Default::default() });
        assert!(r.iter().any(|s| s.key == "other"), "{r:?}");
    }
}

// Docs: docs/03 - Features/Search.md
//! Purpose: orders search results by text match first (typos and word order forgiven), then by what the profile
//! is likely to like and can play: the same score the rows use.
use std::collections::HashMap;

use crate::rank::{quality, taste_score};
use crate::types::{Taste, Title};

/// Lowercase, accents folded, punctuation as spaces: "Amélie!" and "amelie" match, "Spider-Man" reads "spider man".
pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars().flat_map(char::to_lowercase) {
        let c = match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' | 'ø' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ý' | 'ÿ' => 'y',
            'ç' => 'c',
            'ñ' => 'n',
            c => c,
        };
        if c.is_alphanumeric() {
            out.push(c);
        } else if c == '\'' || c == '’' {
            // "Grey's" is "greys": an apostrophe joins, it doesn't split.
        } else if !out.ends_with(' ') && !out.is_empty() {
            out.push(' ');
        }
    }
    out.trim_end().to_string()
}

/// Edits between two words (insert, delete, change, swap two letters), stopping early past `max`.
fn edits(a: &[char], b: &[char], max: usize) -> usize {
    if a.len().abs_diff(b.len()) > max {
        return max + 1;
    }
    let (n, m) = (a.len(), b.len());
    let mut d = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=n {
        let mut best = usize::MAX;
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut v = (d[i - 1][j] + 1).min(d[i][j - 1] + 1).min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                v = v.min(d[i - 2][j - 2] + 1);
            }
            d[i][j] = v;
            best = best.min(v);
        }
        if best > max {
            return max + 1;
        }
    }
    d[n][m]
}

/// How many typos a typed word may have: none under 4 letters, one up to 7, two from 8.
fn allowed(len: usize) -> usize {
    match len {
        0..=3 => 0,
        4..=7 => 1,
        _ => 2,
    }
}

/// Whether a typed word matches a word of the name: its start, or close to it (or to its start, while typing).
fn word_hit(q: &str, w: &str) -> (bool, bool) {
    if w.starts_with(q) {
        return (true, false);
    }
    let (qc, wc): (Vec<char>, Vec<char>) = (q.chars().collect(), w.chars().collect());
    let max = allowed(qc.len());
    if max == 0 {
        return (false, false);
    }
    let head = &wc[..wc.len().min(qc.len())];
    (edits(&qc, &wc, max) <= max || edits(&qc, head, max) <= max, true)
}

/// Every typed word matches a different word of `text`. Returns None, Some(false) if exact starts, Some(true) with typos.
fn all_words(q: &[&str], text: &str) -> Option<bool> {
    let words: Vec<&str> = text.split(' ').collect();
    let mut used = vec![false; words.len()];
    let mut fuzzy = false;
    for qw in q {
        let mut found = None;
        for (i, w) in words.iter().enumerate() {
            if used[i] {
                continue;
            }
            let (hit, typo) = word_hit(qw, w);
            if hit && (found.is_none() || !typo) {
                found = Some((i, typo));
                if !typo {
                    break;
                }
            }
        }
        let (i, typo) = found?;
        used[i] = true;
        fuzzy |= typo;
    }
    Some(fuzzy)
}

fn text_score(query: &str, t: &Title) -> f64 {
    let name = fold(&t.name);
    let q_words: Vec<&str> = query.split(' ').filter(|w| !w.is_empty()).collect();
    let compact = |s: &str| s.replace(' ', "");
    if name == query {
        return 4.0;
    }
    if name.starts_with(query) {
        return 3.0;
    }
    // "spiderman" finds "Spider-Man", "spider man" finds "Spiderman".
    if compact(&name).starts_with(&compact(query)) {
        return 2.6;
    }
    match all_words(&q_words, &name) {
        Some(false) => return 2.2,
        Some(true) => return 1.4,
        None => {}
    }
    if name.contains(query) {
        return 1.5;
    }
    // People and genres: "tom hanks", "comedie", "heist".
    let others = t.people.iter().chain(&t.creators).chain(&t.genres).chain(&t.genre_labels).chain(&t.keywords);
    for x in others {
        let f = fold(x);
        if f.contains(query) || all_words(&q_words, &f) == Some(false) {
            return 1.0;
        }
    }
    0.0
}

/// Returns matching keys, best first. `boost` is each title's score for this profile (how likely it is liked, and
/// whether it plays here), from the app; without one, the taste and reviews alone.
pub fn rank(query: &str, titles: &[Title], taste: &Taste, boost: &HashMap<String, f64>) -> Vec<String> {
    let q = fold(query.trim());
    if q.is_empty() {
        return vec![];
    }
    let mut hits: Vec<(f64, &Title)> = titles
        .iter()
        .filter_map(|t| {
            let m = text_score(&q, t);
            let b = boost.get(&t.key).copied().unwrap_or_else(|| 0.5 * taste_score(taste, t) + 0.3 * quality(t));
            (m > 0.0).then(|| (m + b.clamp(-0.5, 0.95), t))
        })
        .collect();
    hits.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.key.cmp(&b.1.key)));
    hits.into_iter().map(|(_, t)| t.key.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(name: &str, genre: &str) -> Title {
        Title { key: name.into(), name: name.into(), genres: vec![genre.into()], ..Default::default() }
    }
    fn plain(q: &str, ts: &[Title]) -> Vec<String> {
        rank(q, ts, &Taste::default(), &HashMap::new())
    }

    #[test]
    fn an_exact_name_comes_first_and_accents_do_not_matter() {
        let ts = [t("Amelie and friends", "Comedy"), t("Amélie", "Romance")];
        assert_eq!(plain("amelie", &ts)[0], "Amélie");
    }

    #[test]
    fn genres_match_after_names() {
        let ts = [t("Heat", "Crime"), t("Crime Wave", "Drama")];
        assert_eq!(plain("crime", &ts), vec!["Crime Wave", "Heat"]);
    }

    #[test]
    fn an_empty_query_finds_nothing() {
        assert!(plain("  ", &[t("Heat", "Crime")]).is_empty());
    }

    #[test]
    fn typos_and_word_order_are_forgiven() {
        let ts = [t("Breaking Bad", "Drama"), t("Interstellar", "Science Fiction"), t("The Office", "Comedy")];
        assert_eq!(plain("braeking", &ts), vec!["Breaking Bad"]);
        assert_eq!(plain("intersteller", &ts), vec!["Interstellar"]);
        assert_eq!(plain("bad breaking", &ts), vec!["Breaking Bad"]);
        assert_eq!(plain("office", &ts), vec!["The Office"]);
        // Short words must be typed right: "bad" doesn't find "Dad".
        assert!(plain("dad", &ts).is_empty());
    }

    #[test]
    fn hyphens_and_spaces_read_the_same() {
        let ts = [t("Spider-Man", "Action")];
        assert_eq!(plain("spiderman", &ts), vec!["Spider-Man"]);
        assert_eq!(plain("spider man", &ts), vec!["Spider-Man"]);
    }

    #[test]
    fn people_are_found() {
        let mut a = t("Cast Away", "Drama");
        a.people = vec!["Tom Hanks".into()];
        assert_eq!(plain("tom hanks", &[a, t("Heat", "Crime")]), vec!["Cast Away"]);
    }

    #[test]
    fn among_equal_matches_the_profile_score_decides_but_never_beats_a_better_match() {
        let ts = [t("Dark Waters", "Drama"), t("Dark Places", "Thriller"), t("Dark", "Drama")];
        let boost: HashMap<String, f64> = [("Dark Places".to_string(), 0.9), ("Dark Waters".to_string(), 0.1), ("Dark".to_string(), 0.0)].into();
        assert_eq!(rank("dark", &ts, &Taste::default(), &boost), vec!["Dark", "Dark Places", "Dark Waters"]);
    }
}

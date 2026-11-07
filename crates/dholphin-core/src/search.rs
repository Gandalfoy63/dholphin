// Docs: docs/03 - Features/Search.md
//! Purpose: orders search results by text match first, then by taste.
use crate::rank::{quality, taste_score};
use crate::types::{Taste, Title};

/// Lowercase, accents folded, punctuation dropped: "Amélie!" and "amelie" match.
pub fn fold(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c => c,
        })
        .filter(|c| c.is_alphanumeric() || *c == ' ')
        .collect()
}

fn text_score(query: &str, t: &Title) -> f64 {
    let name = fold(&t.name);
    if name == query {
        4.0
    } else if name.starts_with(query) {
        3.0
    } else if name.split(' ').any(|w| w.starts_with(query)) {
        2.0
    } else if name.contains(query) {
        1.5
    } else if t.genres.iter().chain(&t.people).chain(&t.keywords).any(|x| fold(x).contains(query)) {
        1.0
    } else {
        0.0
    }
}

/// Returns matching keys, best first.
pub fn rank(query: &str, titles: &[Title], taste: &Taste) -> Vec<String> {
    let q = fold(query.trim());
    if q.is_empty() {
        return vec![];
    }
    let mut hits: Vec<(f64, &Title)> = titles
        .iter()
        .filter_map(|t| {
            let m = text_score(&q, t);
            (m > 0.0).then(|| (m + 0.5 * taste_score(taste, t) + 0.3 * quality(t), t))
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

    #[test]
    fn an_exact_name_comes_first_and_accents_do_not_matter() {
        let ts = [t("Amelie and friends", "Comedy"), t("Amélie", "Romance")];
        assert_eq!(rank("amelie", &ts, &Taste::default())[0], "Amélie");
    }

    #[test]
    fn genres_match_after_names() {
        let ts = [t("Heat", "Crime"), t("Crime Wave", "Drama")];
        assert_eq!(rank("crime", &ts, &Taste::default()), vec!["Crime Wave", "Heat"]);
    }

    #[test]
    fn an_empty_query_finds_nothing() {
        assert!(rank("  ", &[t("Heat", "Crime")], &Taste::default()).is_empty());
    }
}

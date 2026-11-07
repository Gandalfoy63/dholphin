// Docs: docs/04 - Architecture/Data Model.md
//! Purpose: the data shapes shared with the page. Field names are camelCase in JSON.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Scores {
    pub imdb: Option<f64>,
    pub imdb_votes: Option<u32>,
    pub tomato: Option<f64>,
    pub metacritic: Option<f64>,
    pub tmdb: f64,
    pub tmdb_votes: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Title {
    pub key: String,
    pub tmdb_id: u64,
    pub imdb_id: Option<String>,
    /// "movie" or "series"
    pub kind: String,
    pub name: String,
    pub year: Option<u32>,
    pub release: Option<String>,
    pub overview: String,
    /// Fixed English names, so taste works the same in any language.
    pub genres: Vec<String>,
    /// The names to show, in the profile's language, when known.
    pub genre_labels: Vec<String>,
    pub keywords: Vec<String>,
    pub people: Vec<String>,
    pub creators: Vec<String>,
    pub language: String,
    pub certification: Option<String>,
    pub runtime: Option<u32>,
    pub seasons: Option<u32>,
    pub poster: Option<String>,
    pub backdrop: Option<String>,
    pub trailer: Option<String>,
    pub popularity: f64,
    pub scores: Scores,
    /// TMDB watch provider IDs with a flat-rate offer in the profile's region.
    pub watch_providers: Vec<u32>,
    /// A series' seasons, without specials.
    pub season_list: Vec<SeasonInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct SeasonInfo {
    pub number: u32,
    pub name: String,
    pub episodes: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Signal {
    pub key: String,
    /// love, like, finished, pick, list, watched, abandoned, dislike
    pub kind: String,
    pub age_days: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Taste {
    pub features: BTreeMap<String, f64>,
    /// Highest-weight titles, name by key: they explain a suggestion.
    pub liked: BTreeMap<String, String>,
    pub disliked: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Candidate {
    pub title: Title,
    /// Names of liked titles that recommended this one.
    pub seeds: Vec<String>,
    pub trending: bool,
    /// 1.0 playable, 0.7 requestable, 0.4 neither
    pub available: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct RankOptions {
    pub limit: usize,
    /// Maximal Marginal Relevance: 1.0 is pure score, lower is more varied.
    pub lambda: f64,
    /// Every n-th slot goes to a good title outside the top genres. 0 turns it off.
    pub explore_every: usize,
    pub exclude: Vec<String>,
}

impl Default for RankOptions {
    fn default() -> Self {
        RankOptions { limit: 20, lambda: 0.75, explore_every: 8, exclude: vec![] }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scored {
    pub key: String,
    pub score: f64,
    pub reason: String,
}

// Docs: docs/02 - Tech/Metadata Sources.md
//! Purpose: turns TMDB and OMDb answers into our own title and score shapes.
use crate::types::{Scores, SeasonInfo, Title};
use serde_json::Value;

/// TMDB's fixed genre IDs, for list answers, which carry IDs and no names.
fn genre_name(id: u64) -> Option<&'static str> {
    Some(match id {
        28 => "Action",
        12 => "Adventure",
        16 => "Animation",
        35 => "Comedy",
        80 => "Crime",
        99 => "Documentary",
        18 => "Drama",
        10751 => "Family",
        14 => "Fantasy",
        36 => "History",
        27 => "Horror",
        10402 => "Music",
        9648 => "Mystery",
        10749 => "Romance",
        878 => "Science Fiction",
        10770 => "TV Movie",
        53 => "Thriller",
        10752 => "War",
        37 => "Western",
        10759 => "Action & Adventure",
        10762 => "Kids",
        10763 => "News",
        10764 => "Reality",
        10765 => "Sci-Fi & Fantasy",
        10766 => "Soap",
        10767 => "Talk",
        10768 => "War & Politics",
        _ => return None,
    })
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).filter(|x| !x.is_empty()).map(String::from)
}

fn names(v: Option<&Value>, key: &str, limit: usize) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|x| s(x, key)).take(limit).collect()).unwrap_or_default()
}

/// One title from a list or details object. `kind` is known from the endpoint, or from `media_type`.
fn base(v: &Value, kind: Option<&str>) -> Option<Title> {
    let media = kind.map(String::from).or_else(|| s(v, "media_type")).unwrap_or_else(|| if v.get("first_air_date").is_some() || v.get("name").is_some() { "tv".into() } else { "movie".into() });
    let (series, path) = match media.as_str() {
        "tv" | "series" => (true, "tv"),
        "movie" => (false, "movie"),
        _ => return None, // People in a multi-search.
    };
    let id = v.get("id")?.as_u64()?;
    let name = s(v, if series { "name" } else { "title" }).or_else(|| s(v, "original_title")).or_else(|| s(v, "original_name"))?;
    let release = s(v, if series { "first_air_date" } else { "release_date" });
    let mut genres: Vec<String> = v.get("genre_ids").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_u64).filter_map(genre_name).map(String::from).collect()).unwrap_or_default();
    let genre_labels = names(v.get("genres"), "name", 8);
    if genres.is_empty() {
        // Details carry IDs too: prefer them, as their names change with the language.
        let by_id: Vec<String> = v.get("genres").and_then(Value::as_array).map(|a| a.iter().filter_map(|g| g.get("id")?.as_u64()).filter_map(genre_name).map(String::from).collect()).unwrap_or_default();
        genres = if by_id.is_empty() { genre_labels.clone() } else { by_id };
    }
    Some(Title {
        key: format!("tmdb:{path}:{id}"),
        tmdb_id: id,
        kind: if series { "series".into() } else { "movie".into() },
        name,
        year: release.as_deref().and_then(|d| d.get(..4)).and_then(|y| y.parse().ok()),
        release,
        overview: s(v, "overview").unwrap_or_default(),
        genres,
        genre_labels,
        language: s(v, "original_language").unwrap_or_default(),
        poster: s(v, "poster_path"),
        backdrop: s(v, "backdrop_path"),
        popularity: v.get("popularity").and_then(Value::as_f64).unwrap_or(0.0),
        scores: Scores { tmdb: v.get("vote_average").and_then(Value::as_f64).unwrap_or(0.0), tmdb_votes: v.get("vote_count").and_then(Value::as_u64).unwrap_or(0) as u32, ..Default::default() },
        ..Default::default()
    })
}

/// A TMDB list: `{results: [...]}`. Entries that aren't titles are skipped.
pub fn list(json: &Value, kind: Option<&str>) -> Vec<Title> {
    json.get("results").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| base(v, kind)).collect()).unwrap_or_default()
}

fn certification(v: &Value, series: bool, region: &str) -> Option<String> {
    let pick = |want: &str| -> Option<String> {
        if series {
            v.pointer("/content_ratings/results")?.as_array()?.iter().find(|r| r["iso_3166_1"] == want).and_then(|r| s(r, "rating"))
        } else {
            v.pointer("/release_dates/results")?.as_array()?.iter().find(|r| r["iso_3166_1"] == want)?["release_dates"].as_array()?.iter().find_map(|d| s(d, "certification"))
        }
    };
    pick(region).or_else(|| pick("US"))
}

/// A details answer, with `append_to_response=credits,keywords,external_ids,videos,release_dates,content_ratings,watch/providers`.
pub fn details(v: &Value, kind: &str, region: &str) -> Option<Title> {
    let series = kind == "series" || kind == "tv";
    let mut t = base(v, Some(if series { "tv" } else { "movie" }))?;
    t.imdb_id = v.pointer("/external_ids/imdb_id").and_then(Value::as_str).filter(|x| !x.is_empty()).map(String::from).or_else(|| s(v, "imdb_id"));
    t.keywords = names(v.pointer(if series { "/keywords/results" } else { "/keywords/keywords" }), "name", 15);
    t.people = names(v.pointer("/credits/cast"), "name", 5);
    t.creators = if series {
        names(v.get("created_by"), "name", 3)
    } else {
        v.pointer("/credits/crew").and_then(Value::as_array).map(|c| c.iter().filter(|p| p["job"] == "Director").filter_map(|p| s(p, "name")).take(2).collect()).unwrap_or_default()
    };
    t.certification = certification(v, series, region);
    t.runtime = if series { v.pointer("/episode_run_time/0").and_then(Value::as_u64).map(|x| x as u32) } else { v.get("runtime").and_then(Value::as_u64).map(|x| x as u32) };
    t.seasons = v.get("number_of_seasons").and_then(Value::as_u64).map(|x| x as u32);
    t.season_list = v.get("seasons").and_then(Value::as_array).map(|a| {
        a.iter()
            .filter_map(|x| {
                let number = x.get("season_number")?.as_u64()? as u32;
                (number > 0).then(|| SeasonInfo { number, name: s(x, "name").unwrap_or_else(|| format!("Season {number}")), episodes: x.get("episode_count").and_then(Value::as_u64).unwrap_or(0) as u32 })
            })
            .collect()
    }).unwrap_or_default();
    if t.season_list.is_empty() {
        // Some answers give only the count.
        t.season_list = (1..=t.seasons.unwrap_or(0)).map(|number| SeasonInfo { number, name: format!("Season {number}"), episodes: 0 }).collect();
    }
    t.trailer = v.pointer("/videos/results").and_then(Value::as_array).and_then(|a| a.iter().find(|x| x["site"] == "YouTube" && x["type"] == "Trailer")).and_then(|x| s(x, "key"));
    t.watch_providers = v.get("watch/providers").and_then(|w| w.pointer(&format!("/results/{region}/flatrate"))).and_then(Value::as_array).map(|a| a.iter().filter_map(|p| p["provider_id"].as_u64()).map(|x| x as u32).collect()).unwrap_or_default();
    Some(t)
}

fn number(v: Option<&str>) -> Option<f64> {
    v?.replace([',', '%'], "").split('/').next()?.trim().parse().ok()
}

/// An OMDb answer: IMDb rating and votes, the Rotten Tomatoes and Metacritic scores.
pub fn omdb(v: &Value) -> Scores {
    let rating = |source: &str| v.get("Ratings").and_then(Value::as_array).and_then(|a| a.iter().find(|r| r["Source"] == source)).and_then(|r| number(r["Value"].as_str()));
    Scores {
        imdb: number(v.get("imdbRating").and_then(Value::as_str)),
        imdb_votes: number(v.get("imdbVotes").and_then(Value::as_str)).map(|x| x as u32),
        tomato: rating("Rotten Tomatoes"),
        metacritic: rating("Metacritic"),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lists_map_movies_and_series_and_skip_people() {
        let j = json!({"results":[
            {"media_type":"movie","id":1,"title":"Heat","release_date":"1995-12-15","genre_ids":[80,53],"vote_average":8.3,"vote_count":10,"poster_path":"/p.jpg"},
            {"media_type":"tv","id":2,"name":"Dark","first_air_date":"2017-12-01","genre_ids":[18]},
            {"media_type":"person","id":3,"name":"Someone"}]});
        let l = list(&j, None);
        assert_eq!(l.len(), 2);
        assert_eq!((l[0].key.as_str(), l[0].year, l[0].genres[1].as_str()), ("tmdb:movie:1", Some(1995), "Thriller"));
        assert_eq!((l[1].key.as_str(), l[1].kind.as_str()), ("tmdb:tv:2", "series"));
    }

    #[test]
    fn a_broken_list_is_empty() {
        assert!(list(&json!({"oops":1}), None).is_empty());
        assert!(list(&json!({"results":[{"id":"x"}]}), Some("movie")).is_empty());
    }

    #[test]
    fn details_read_the_appended_data_for_the_region() {
        let j = json!({"id":9,"title":"Heat","release_date":"1995-12-15","genres":[{"name":"Crime"}],"runtime":170,
          "external_ids":{"imdb_id":"tt0113277"},"keywords":{"keywords":[{"name":"heist"}]},
          "credits":{"cast":[{"name":"A"}],"crew":[{"job":"Director","name":"D"},{"job":"Writer","name":"W"}]},
          "release_dates":{"results":[{"iso_3166_1":"FR","release_dates":[{"certification":""},{"certification":"12"}]}]},
          "videos":{"results":[{"site":"Vimeo","type":"Trailer","key":"no"},{"site":"YouTube","type":"Trailer","key":"yes"}]},
          "watch/providers":{"results":{"FR":{"flatrate":[{"provider_id":8}]},"US":{"flatrate":[{"provider_id":99}]}}}});
        let t = details(&j, "movie", "FR").unwrap();
        assert_eq!(t.imdb_id.as_deref(), Some("tt0113277"));
        assert_eq!(t.certification.as_deref(), Some("12"));
        assert_eq!(t.creators, vec!["D"]);
        assert_eq!(t.trailer.as_deref(), Some("yes"));
        assert_eq!(t.watch_providers, vec![8]);
        assert_eq!(t.keywords, vec!["heist"]);
    }

    #[test]
    fn series_details_use_their_own_fields() {
        let j = json!({"id":2,"name":"Dark","first_air_date":"2017-12-01","number_of_seasons":3,"episode_run_time":[55],"created_by":[{"name":"B"}],
          "keywords":{"results":[{"name":"time travel"}]},"content_ratings":{"results":[{"iso_3166_1":"US","rating":"TV-MA"}]}});
        let t = details(&j, "series", "FR").unwrap();
        assert_eq!((t.seasons, t.runtime), (Some(3), Some(55)));
        assert_eq!(t.certification.as_deref(), Some("TV-MA"));
        assert_eq!(t.creators, vec!["B"]);
    }

    #[test]
    fn genres_stay_the_same_in_any_language() {
        let t = details(&json!({"id":1,"title":"A","genres":[{"id":35,"name":"Comédie"}]}), "movie", "FR").unwrap();
        assert_eq!(t.genres, vec!["Comedy"]);
        assert_eq!(t.genre_labels, vec!["Comédie"]);
    }

    #[test]
    fn seasons_leave_out_specials_and_survive_a_missing_list() {
        let j = json!({"id":2,"name":"Dark","seasons":[{"season_number":0,"name":"Specials","episode_count":9},{"season_number":1,"name":"Season 1","episode_count":10},{"season_number":2,"episode_count":8}]});
        let l = details(&j, "series", "US").unwrap().season_list;
        assert_eq!(l.iter().map(|x| x.number).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!((l[1].name.as_str(), l[1].episodes), ("Season 2", 8));
        let c = details(&json!({"id":2,"name":"Dark","number_of_seasons":2}), "series", "US").unwrap().season_list;
        assert_eq!(c.len(), 2);
    }

    #[test]
    fn omdb_reads_numbers_and_tolerates_gaps() {
        let s = omdb(&json!({"imdbRating":"8.3","imdbVotes":"712,345","Ratings":[{"Source":"Rotten Tomatoes","Value":"88%"},{"Source":"Metacritic","Value":"76/100"}]}));
        assert_eq!((s.imdb, s.imdb_votes, s.tomato, s.metacritic), (Some(8.3), Some(712345), Some(88.0), Some(76.0)));
        assert_eq!(omdb(&json!({"imdbRating":"N/A","Response":"True"})).imdb, None);
    }
}

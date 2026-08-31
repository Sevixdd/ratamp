use serde::Deserialize;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be registered first so Windows/Linux deep links reach the existing instance.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            println!("single-instance: {argv:?}");
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![lookup_track_genres])
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn lookup_track_genres(artist: String, title: String) -> Result<Vec<String>, String> {
    let artist = artist.trim().to_string();
    let title = title.trim().to_string();

    if artist.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("RatAMP/0.1")
        .build()
        .map_err(|err| err.to_string())?;

    if let Ok(genres) = audiodb_genres(&client, &artist).await {
        if !genres.is_empty() {
            return Ok(genres);
        }
    }

    if !title.is_empty() {
        if let Ok(genres) = deezer_genres(&client, &artist, &title).await {
            if !genres.is_empty() {
                return Ok(genres);
            }
        }
    }

    Ok(Vec::new())
}

#[derive(Deserialize)]
struct AudioDbResponse {
    artists: Option<Vec<AudioDbArtist>>,
}

#[derive(Deserialize)]
struct AudioDbArtist {
    #[serde(rename = "strGenre")]
    genre: Option<String>,
    #[serde(rename = "strStyle")]
    style: Option<String>,
}

async fn audiodb_genres(
    client: &reqwest::Client,
    artist: &str,
) -> Result<Vec<String>, reqwest::Error> {
    let data = client
        .get("https://www.theaudiodb.com/api/v1/json/2/search.php")
        .query(&[("s", artist)])
        .send()
        .await?
        .json::<AudioDbResponse>()
        .await?;

    Ok(data
        .artists
        .unwrap_or_default()
        .into_iter()
        .flat_map(|item| [item.genre, item.style])
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect())
}

#[derive(Deserialize)]
struct DeezerSearch {
    data: Option<Vec<DeezerTrack>>,
}

#[derive(Deserialize)]
struct DeezerTrack {
    album: Option<DeezerAlbumRef>,
}

#[derive(Deserialize)]
struct DeezerAlbumRef {
    id: Option<u64>,
}

#[derive(Deserialize)]
struct DeezerAlbum {
    genre_id: Option<i64>,
    genres: Option<DeezerGenreList>,
}

#[derive(Deserialize)]
struct DeezerGenreList {
    data: Option<Vec<DeezerGenre>>,
}

#[derive(Deserialize)]
struct DeezerGenre {
    name: Option<String>,
}

async fn deezer_genres(
    client: &reqwest::Client,
    artist: &str,
    title: &str,
) -> Result<Vec<String>, reqwest::Error> {
    let query = format!("artist:\"{artist}\" track:\"{title}\"");
    let search = client
        .get("https://api.deezer.com/search")
        .query(&[("q", query.as_str()), ("limit", "5")])
        .send()
        .await?
        .json::<DeezerSearch>()
        .await?;

    let album_id = search
        .data
        .unwrap_or_default()
        .into_iter()
        .find_map(|item| item.album.and_then(|album| album.id));

    let Some(album_id) = album_id else {
        return Ok(Vec::new());
    };

    let album = client
        .get(format!("https://api.deezer.com/album/{album_id}"))
        .send()
        .await?
        .json::<DeezerAlbum>()
        .await?;

    let mut genres = album
        .genres
        .and_then(|list| list.data)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|genre| genre.name)
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();

    if genres.is_empty() {
        if let Some(genre_id) = album.genre_id.filter(|id| *id > 0) {
            let genre = client
                .get(format!("https://api.deezer.com/genre/{genre_id}"))
                .send()
                .await?
                .json::<DeezerGenre>()
                .await?;
            if let Some(name) = genre.name {
                let name = name.trim().to_string();
                if !name.is_empty() {
                    genres.push(name);
                }
            }
        }
    }

    Ok(genres)
}

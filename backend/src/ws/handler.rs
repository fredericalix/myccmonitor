use crate::auth::AuthenticatedUser;
use crate::db::orgs;
use crate::error::AppError;
use crate::state::AppState;
use crate::ws::WsFrame;
use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::broadcast;

pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(ws_handler))
}

#[derive(Deserialize)]
struct WsParams {
    org: String,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Query(params): Query<WsParams>,
) -> Result<Response, AppError> {
    // Only let users connect to orgs they actually own (= cached after a list).
    let _ = orgs::find_by_user_and_cc_id(&state.pool, auth.id, &params.org)
        .await?
        .ok_or(AppError::Forbidden)?;

    let rx = state.ws_bus.subscribe(&params.org);
    let cc_org_id = params.org.clone();
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, rx, cc_org_id)))
}

async fn handle_socket(
    socket: WebSocket,
    mut rx: broadcast::Receiver<WsFrame>,
    cc_org_id: String,
) {
    let (mut sender, mut receiver) = socket.split();

    // Forward broadcast → client
    let send = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(frame) => {
                    let json = match serde_json::to_string(&frame) {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::error!(error = ?e, "frame serialize failed");
                            continue;
                        }
                    };
                    if sender.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(lagged = n, "WS client lagged; some frames dropped");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Drain client → backend (we don't accept commands yet; just keep the connection alive
    // and respond to ping frames automatically).
    let recv = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Close(_)) | Err(_) => break,
                _ => continue,
            }
        }
    });

    tokio::select! {
        _ = send => {}
        _ = recv => {}
    }
    tracing::debug!(%cc_org_id, "WS client disconnected");
}

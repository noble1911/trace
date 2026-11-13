use super::*;

#[test]
fn a_request_reads_as_a_flat_tagged_object() {
    let env = parse_request(r#"{"id":3,"type":"attach","workspaceId":"TRACE-12","fromSeq":40}"#)
        .expect("a valid attach");
    assert_eq!(env.id, Some(3));
    assert_eq!(
        env.request,
        Request::Attach {
            workspace_id: "TRACE-12".into(),
            from_seq: 40
        }
    );
}

#[test]
fn requests_round_trip() {
    let all = [
        Request::Hello {
            protocol: PROTOCOL_VERSION,
            token: "t".into(),
            client_name: "laptop".into(),
        },
        Request::List,
        Request::Spawn {
            repo: "acme/widgets".into(),
            cli: "claude".into(),
            prompt: Some("fix it".into()),
            title: None,
            cols: 100,
            rows: 30,
        },
        Request::Detach {
            workspace_id: "w".into(),
        },
        Request::Input {
            workspace_id: "w".into(),
            data: "aGk=".into(),
        },
        Request::Resize {
            workspace_id: "w".into(),
            cols: 120,
            rows: 40,
        },
        Request::Stop {
            workspace_id: "w".into(),
        },
    ];
    for request in all {
        let env = Envelope {
            id: Some(1),
            request,
        };
        let text = serde_json::to_string(&env).expect("serializes");
        assert_eq!(parse_request(&text).expect("parses"), env);
    }
}

#[test]
fn an_unknown_request_is_an_error_addressed_to_its_id() {
    let (id, message) =
        parse_request(r#"{"id":9,"type":"startSession","repo":"x"}"#).expect_err("unknown");
    assert_eq!(id, Some(9));
    assert!(message.contains("understands"));
}

#[test]
fn garbage_is_an_error_without_an_id() {
    let (id, _) = parse_request("not json").expect_err("garbage");
    assert_eq!(id, None);
}

#[test]
fn events_use_camel_case_and_omit_a_missing_id() {
    let event = Event::Attached {
        id: None,
        workspace_id: "w".into(),
        reset: true,
        cols: 80,
        rows: 24,
    };
    let json = serde_json::to_value(&event).expect("serializes");
    assert_eq!(json["type"], "attached");
    assert_eq!(json["workspaceId"], "w");
    assert!(json.get("id").is_none());
}

#[test]
fn a_turn_reads_from_the_agent_turn_payload() {
    // The server forwards its own `agent-turn` events, which have no `type`.
    let payload = r#"{"workspaceId":"w","event":"needsInput","backgroundTasks":0,
        "notificationType":"permission_prompt","message":"Allow Bash?","lastMessage":null}"#;
    let mut value: serde_json::Value = serde_json::from_str(payload).expect("json");
    value["type"] = "turn".into();
    let event: Event = serde_json::from_value(value).expect("a turn");
    assert!(matches!(event, Event::Turn { ref event, .. } if event == "needsInput"));
}

#[test]
fn a_welcome_carries_the_servers_capabilities() {
    use crate::execution::peer::capabilities::{RepoSummary, ServerCapabilities};
    let event = Event::Welcome {
        capabilities: ServerCapabilities::new(
            "box",
            vec!["claude".into()],
            vec![RepoSummary {
                name: "acme/widgets".into(),
                remote: Some("github.com/acme/widgets".into()),
            }],
        ),
    };
    let json = serde_json::to_value(&event).expect("serializes");
    assert_eq!(json["type"], "welcome");
    assert_eq!(json["capabilities"]["protocol"], PROTOCOL_VERSION);
    assert_eq!(json["capabilities"]["repos"][0]["name"], "acme/widgets");
    let back: Event = serde_json::from_value(json).expect("reads back");
    assert_eq!(back, event);
}

#[test]
fn a_spawn_needs_a_repo_and_agent_but_not_a_prompt() {
    let env =
        parse_request(r#"{"id":4,"type":"spawn","repo":"r","cli":"codex","cols":80,"rows":24}"#)
            .expect("a spawn without a prompt");
    assert!(matches!(env.request, Request::Spawn { prompt: None, .. }));
    assert!(parse_request(r#"{"type":"spawn","cli":"claude","cols":80,"rows":24}"#).is_err());
}

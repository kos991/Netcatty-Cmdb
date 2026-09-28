package store

import (
	"strings"
	"testing"
)

func TestSwitchSnapshotKeepsLatestSanitizedResultPerProject(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	assetID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "核心交换机", DeviceType: "switch"})
	if err != nil {
		t.Fatal(err)
	}

	first := &CmdbSwitchSnapshot{AssetID: assetID, Vendor: "huawei", Protocol: "ssh", HostID: "host-1", ReadAt: "2026-09-22T10:00:00Z", SnapshotJSON: `{"device":{"name":"CORE-SW"},"interfaces":[{"name":"GE0/0/1"}]}`}
	if err := s.SaveCmdbSwitchSnapshotForProject(scope, first); err != nil {
		t.Fatal(err)
	}
	second := &CmdbSwitchSnapshot{AssetID: assetID, Vendor: "huawei", Protocol: "ssh", HostID: "host-1", ReadAt: "2026-09-22T11:00:00Z", SnapshotJSON: `{"device":{"name":"CORE-SW-2"},"interfaces":[]}`}
	if err := s.SaveCmdbSwitchSnapshotForProject(scope, second); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetCmdbSwitchSnapshotForProject(scope, assetID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ReadAt != second.ReadAt || !strings.Contains(got.SnapshotJSON, "CORE-SW-2") {
		t.Fatalf("未保存最近快照: %+v", got)
	}
}

func TestSwitchSnapshotRejectsSecretsAndNonSwitchAsset(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	serverID, _ := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "服务器", DeviceType: "server"})
	if err := s.SaveCmdbSwitchSnapshotForProject(scope, &CmdbSwitchSnapshot{AssetID: serverID, SnapshotJSON: `{}`}); err == nil || !strings.Contains(err.Error(), "交换机") {
		t.Fatalf("非交换机资产应拒绝: %v", err)
	}
	switchID, _ := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "交换机", DeviceType: "switch"})
	if err := s.SaveCmdbSwitchSnapshotForProject(scope, &CmdbSwitchSnapshot{AssetID: switchID, SnapshotJSON: `{"snmp":{"community":"public"}}`}); err == nil || !strings.Contains(err.Error(), "敏感") {
		t.Fatalf("秘密字段应拒绝: %v", err)
	}
}

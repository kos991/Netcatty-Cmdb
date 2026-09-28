package store

import (
	"path/filepath"
	"testing"
)

func TestCmdbAssetHistoryPersistsAssetAndLinkChanges(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "cmdb_history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	localID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "核心交换机", DeviceType: "switch"})
	if err != nil {
		t.Fatal(err)
	}
	peerID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "业务服务器", DeviceType: "server"})
	if err != nil {
		t.Fatal(err)
	}
	linkID, err := s.CreateCmdbAssetLinkForProject(scope, &CmdbAssetLink{LocalAssetID: localID, LocalPort: "Gi1/0/12", Direction: "downlink", PeerAssetID: peerID, PeerPort: "eth0"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCmdbAssetLinkForProject(scope, linkID); err != nil {
		t.Fatal(err)
	}
	history, err := s.ListCmdbAssetHistoryForProject(scope, localID, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 3 {
		t.Fatalf("预期建档、新增链路、删除链路三条履历，实际 %+v", history)
	}
	want := []string{"删除链路", "新增链路", "资产建档"}
	for i := range want {
		if history[i].Type != want[i] {
			t.Fatalf("履历顺序或类型错误: %+v", history)
		}
	}
}

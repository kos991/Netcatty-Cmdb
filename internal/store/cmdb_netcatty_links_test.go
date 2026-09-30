package store

import (
	"errors"
	"strings"
	"testing"
)

func TestCmdbNetcattyLinkKeepsReferencesWithoutSecrets(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	assetID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "核心交换机", AssetCode: "SW-001"})
	if err != nil {
		t.Fatal(err)
	}

	link := &CmdbNetcattyLink{
		AssetType: "infrastructure", AssetID: assetID,
		HostID: "host-1", HostName: "核心交换机 SSH", Protocol: "ssh", Address: "10.20.30.1", Port: 22,
		CredentialID: "identity-1", CredentialName: "网络设备账号", IsPrimary: true,
	}
	if _, err := s.SaveCmdbNetcattyLinkForProject(scope, link); err != nil {
		t.Fatal(err)
	}
	links, err := s.ListCmdbNetcattyLinksForProject(scope, "infrastructure", assetID)
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 1 || links[0].AssetSyncID == "" || links[0].State != "linked" {
		t.Fatalf("主机引用保存错误: %+v", links)
	}
	if strings.Contains(strings.ToLower(links[0].HostName+links[0].CredentialName), "password") {
		t.Fatalf("引用元数据疑似包含秘密: %+v", links[0])
	}

	if err := s.MarkCmdbNetcattyLinkStateForProject(scope, links[0].ID, "unresolved"); err != nil {
		t.Fatal(err)
	}
	links, err = s.ListCmdbNetcattyLinksForProject(scope, "infrastructure", assetID)
	if err != nil || len(links) != 1 || links[0].State != "unresolved" {
		t.Fatalf("失效引用应保留: links=%+v err=%v", links, err)
	}
}

func TestCmdbNetcattyPrimaryHostCanBelongToOnlyOneAsset(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	firstID, _ := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "交换机 A"})
	secondID, _ := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "交换机 B"})

	if _, err := s.SaveCmdbNetcattyLinkForProject(scope, &CmdbNetcattyLink{AssetType: "infrastructure", AssetID: firstID, HostID: "host-shared", IsPrimary: true}); err != nil {
		t.Fatal(err)
	}
	_, err := s.SaveCmdbNetcattyLinkForProject(scope, &CmdbNetcattyLink{AssetType: "infrastructure", AssetID: secondID, HostID: "host-shared", IsPrimary: true})
	if !errors.Is(err, ErrNetcattyHostAlreadyLinked) {
		t.Fatalf("重复主关联应被拒绝，实际错误: %v", err)
	}
}

func TestCmdbNetcattyCredentialCanBeLinkedWithoutHost(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	assetID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "应用节点"})
	if err != nil {
		t.Fatal(err)
	}
	linkID, err := s.SaveCmdbNetcattyLinkForProject(scope, &CmdbNetcattyLink{
		AssetType: "infrastructure", AssetID: assetID,
		CredentialID: "key-standalone", CredentialName: "独立运维密钥",
	})
	if err != nil {
		t.Fatal(err)
	}
	links, err := s.ListCmdbNetcattyLinksForProject(scope, "infrastructure", assetID)
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 1 || links[0].ID != linkID || links[0].HostID != "" || links[0].CredentialID != "key-standalone" {
		t.Fatalf("钥匙串单独关联保存错误: %+v", links)
	}
}

func TestNetcattyHostUsageCountsOtherProjectsWithoutReturningLinks(t *testing.T) {
	s := newCmdbTestStore(t)
	first, _ := s.DefaultProjectScope()
	secondProject, err := s.CreateCmdbProject(&CmdbProject{Code: "OTHER", Name: "其他项目"})
	if err != nil {
		t.Fatal(err)
	}
	second := ProjectScope{ProjectID: secondProject.ID}
	firstAsset, err := s.CreateCmdbAssetManualForProject(first, &CmdbAsset{Name: "本项目设备"})
	if err != nil {
		t.Fatal(err)
	}
	secondAsset, err := s.CreateCmdbAssetManualForProject(second, &CmdbAsset{Name: "其他项目设备"})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		scope   ProjectScope
		assetID int64
	}{{first, firstAsset}, {second, secondAsset}} {
		if _, err := s.SaveCmdbNetcattyLinkForProject(item.scope, &CmdbNetcattyLink{AssetType: "infrastructure", AssetID: item.assetID, HostID: "shared-host", IsPrimary: true}); err != nil {
			t.Fatal(err)
		}
	}
	count, err := s.CountOtherCmdbNetcattyHostReferences(first, "shared-host", "infrastructure", firstAsset)
	if err != nil || count != 1 {
		t.Fatalf("跨项目引用计数=%d, err=%v", count, err)
	}
}

func TestSetDefaultNetcattyLinkRollsBackOnWriteFailure(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	assetID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "双主机设备"})
	if err != nil {
		t.Fatal(err)
	}
	oldID, err := s.SaveCmdbNetcattyLinkForProject(scope, &CmdbNetcattyLink{AssetType: "infrastructure", AssetID: assetID, HostID: "old-host", IsPrimary: true})
	if err != nil {
		t.Fatal(err)
	}
	newID, err := s.SaveCmdbNetcattyLinkForProject(scope, &CmdbNetcattyLink{AssetType: "infrastructure", AssetID: assetID, HostID: "new-host"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER fail_new_default BEFORE UPDATE OF is_primary ON cmdb_netcatty_links WHEN NEW.host_id='new-host' AND NEW.is_primary=1 BEGIN SELECT RAISE(ABORT, '写入失败'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.SetDefaultCmdbNetcattyLinkForProject(scope, newID); err == nil {
		t.Fatal("目标写入失败必须返回错误")
	}
	links, err := s.ListCmdbNetcattyLinksForProject(scope, "infrastructure", assetID)
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 2 || links[0].ID != oldID || !links[0].IsPrimary || links[1].IsPrimary {
		t.Fatalf("事务失败后默认连接发生变化: %+v", links)
	}
}

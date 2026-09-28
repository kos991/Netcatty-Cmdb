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

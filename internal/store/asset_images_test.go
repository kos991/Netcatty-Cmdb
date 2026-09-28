package store

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"strings"
	"testing"
)

func testAssetJPEG(t *testing.T) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, img, nil); err != nil {
		t.Fatal(err)
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buffer.Bytes())
}

func TestAssetImagesSaveReadAndSync(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	terminalID, err := s.CreateAsset(&Asset{AssetCode: "PHOTO-1", DeviceType: "台式电脑"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	infraID, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "照片服务器", DeviceType: "server", AssetClass: "physical"})
	if err != nil {
		t.Fatal(err)
	}
	photo := testAssetJPEG(t)
	for _, item := range []struct {
		kind string
		id   int64
	}{{"terminal", terminalID}, {"infrastructure", infraID}} {
		if err := s.SetAssetImageForProject(scope, item.kind, item.id, "front", photo); err != nil {
			t.Fatal(err)
		}
		images, err := s.GetAssetImagesForProject(scope, item.kind, item.id)
		if err != nil || images.Front != photo || images.Back != "" {
			t.Fatalf("图片未正确保存: images=%+v err=%v", images, err)
		}
		if err := s.SetAssetImageForProject(scope, item.kind, item.id, "front", ""); err != nil {
			t.Fatal(err)
		}
		if err := s.SetAssetImageForProject(scope, item.kind, item.id, "back", photo); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := s.ExportCmdbSnapshot(scope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"assets", "cmdb_assets"} {
		var records []map[string]any
		if err := json.Unmarshal(snapshot.Collections[table], &records); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, record := range records {
			if record["back_image"] == photo {
				found = true
			}
		}
		if !found {
			t.Fatalf("%s 照片未进入云同步快照", table)
		}
	}
}

func TestAssetImagesRejectInvalidOrVirtualAsset(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, _ := s.DefaultProjectScope()
	id, err := s.CreateCmdbAssetManualForProject(scope, &CmdbAsset{Name: "虚拟机", DeviceType: "virtual_machine", AssetClass: "virtual"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetAssetImageForProject(scope, "infrastructure", id, "front", testAssetJPEG(t)); err == nil {
		t.Fatal("虚拟机不应允许上传设备照片")
	}
	terminalID, err := s.CreateAsset(&Asset{AssetCode: "PHOTO-2"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	for _, data := range []string{"data:image/png;base64,AAAA", "data:image/jpeg;base64,AAAA", "data:image/jpeg;base64," + strings.Repeat("A", 700000)} {
		if err := s.SetAssetImageForProject(scope, "terminal", terminalID, "front", data); err == nil {
			t.Fatalf("无效或过大的照片必须拒绝: %d 字符", len(data))
		}
	}
	if err := s.SetAssetImageForProject(scope, "terminal", terminalID, "side", testAssetJPEG(t)); err == nil {
		t.Fatal("只能设置正面或背面")
	}
}

func TestAssetImagesSurviveSnapshotApply(t *testing.T) {
	remote, remoteScope := openSnapshotTestStore(t)
	local, localScope := openSnapshotTestStore(t)
	project, err := remote.ResolveProject(remoteScope)
	if err != nil {
		t.Fatal(err)
	}
	alignSnapshotProject(t, local, localScope, project.SyncID)
	terminalID, err := remote.CreateAssetForProject(remoteScope, &Asset{AssetCode: "SYNC-PHOTO", DeviceType: "台式电脑"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	infraID, err := remote.CreateCmdbAssetManualForProject(remoteScope, &CmdbAsset{Name: "同步交换机", DeviceType: "switch", AssetClass: "physical"})
	if err != nil {
		t.Fatal(err)
	}
	photo := testAssetJPEG(t)
	if err := remote.SetAssetImageForProject(remoteScope, "terminal", terminalID, "front", photo); err != nil {
		t.Fatal(err)
	}
	if err := remote.SetAssetImageForProject(remoteScope, "infrastructure", infraID, "back", photo); err != nil {
		t.Fatal(err)
	}
	snapshot, err := remote.ExportCmdbSnapshot(remoteScope, SnapshotExportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.ApplyCmdbSnapshot(localScope, snapshot); err != nil {
		t.Fatal(err)
	}
	var localTerminalID, localInfraID int64
	if err := local.db.QueryRow(`SELECT id FROM assets WHERE project_id=? AND asset_code='SYNC-PHOTO'`, localScope.ProjectID).Scan(&localTerminalID); err != nil {
		t.Fatal(err)
	}
	if err := local.db.QueryRow(`SELECT id FROM cmdb_assets WHERE project_id=? AND name='同步交换机'`, localScope.ProjectID).Scan(&localInfraID); err != nil {
		t.Fatal(err)
	}
	terminalImages, err := local.GetAssetImagesForProject(localScope, "terminal", localTerminalID)
	if err != nil || terminalImages.Front != photo {
		t.Fatalf("终端正面照片同步失败: images=%+v err=%v", terminalImages, err)
	}
	infraImages, err := local.GetAssetImagesForProject(localScope, "infrastructure", localInfraID)
	if err != nil || infraImages.Back != photo {
		t.Fatalf("基础设施背面照片同步失败: images=%+v err=%v", infraImages, err)
	}
}

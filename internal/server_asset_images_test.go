package internal

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"czfy-assets/internal/store"
)

func TestAssetImageHTTPPutAndGet(t *testing.T) {
	s := newCmdbTestServer(t)
	id, err := s.Store.CreateAsset(&store.Asset{AssetCode: "PHOTO-HTTP", DeviceType: "台式电脑"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	var imageBytes bytes.Buffer
	if err := jpeg.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 2, 2)), nil); err != nil {
		t.Fatal(err)
	}
	photo := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(imageBytes.Bytes())
	body, _ := json.Marshal(map[string]string{"side": "front", "data": photo})
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	path := "/api/cmdb/asset-images/terminal/" + strconv.FormatInt(id, 10)
	put := httptest.NewRecorder()
	mux.ServeHTTP(put, httptest.NewRequest(http.MethodPut, path, bytes.NewReader(body)))
	if put.Code != http.StatusOK {
		t.Fatalf("保存照片失败: %d %s", put.Code, put.Body.String())
	}
	get := httptest.NewRecorder()
	mux.ServeHTTP(get, httptest.NewRequest(http.MethodGet, path, nil))
	var images store.AssetImages
	if get.Code != http.StatusOK || json.Unmarshal(get.Body.Bytes(), &images) != nil || images.Front != photo {
		t.Fatalf("读取照片失败: %d %s", get.Code, get.Body.String())
	}
	bad := httptest.NewRecorder()
	mux.ServeHTTP(bad, httptest.NewRequest(http.MethodPut, path, bytes.NewBufferString(`{"side":"back","data":"data:image/png;base64,AAAA"}`)))
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("无效照片应返回 400: %d %s", bad.Code, bad.Body.String())
	}
}

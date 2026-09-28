package store

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"image/jpeg"
	"strings"
)

const maxAssetImageBytes = 500 * 1024

type AssetImages struct {
	Front string `json:"front_image"`
	Back  string `json:"back_image"`
}

func assetImageTable(kind string) (string, error) {
	switch kind {
	case "terminal":
		return "assets", nil
	case "infrastructure":
		return "cmdb_assets", nil
	default:
		return "", fmt.Errorf("不支持的设备类型: %s", kind)
	}
}

func (s *Store) GetAssetImagesForProject(scope ProjectScope, kind string, id int64) (*AssetImages, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	table, err := assetImageTable(kind)
	if err != nil {
		return nil, err
	}
	var images AssetImages
	err = s.db.QueryRow(`SELECT IFNULL(front_image,''),IFNULL(back_image,'') FROM `+table+` WHERE project_id=? AND id=? AND deleted_at IS NULL`, scope.ProjectID, id).Scan(&images.Front, &images.Back)
	if err != nil {
		return nil, err
	}
	return &images, nil
}

func (s *Store) SetAssetImageForProject(scope ProjectScope, kind string, id int64, side, dataURL string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	table, err := assetImageTable(kind)
	if err != nil {
		return err
	}
	column := ""
	switch side {
	case "front":
		column = "front_image"
	case "back":
		column = "back_image"
	default:
		return errors.New("照片位置只能是正面或背面")
	}
	if dataURL != "" {
		const prefix = "data:image/jpeg;base64,"
		if !strings.HasPrefix(dataURL, prefix) || len(dataURL) > len(prefix)+base64.StdEncoding.EncodedLen(maxAssetImageBytes) {
			return errors.New("仅支持不超过 500 KiB 的 JPEG 照片")
		}
		data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, prefix))
		if err != nil || len(data) > maxAssetImageBytes {
			return errors.New("照片编码无效或超过 500 KiB")
		}
		config, err := jpeg.DecodeConfig(bytes.NewReader(data))
		if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 2400 || config.Height > 2400 {
			return errors.New("照片不是有效 JPEG，或尺寸超过 2400 像素")
		}
	}
	if kind == "infrastructure" {
		var assetClass, deviceType string
		if err := s.db.QueryRow(`SELECT IFNULL(asset_class,''),IFNULL(device_type,'') FROM cmdb_assets WHERE project_id=? AND id=? AND deleted_at IS NULL`, scope.ProjectID, id).Scan(&assetClass, &deviceType); err != nil {
			return err
		}
		if assetClass == "virtual" || strings.Contains(strings.ToLower(deviceType), "virtual") || strings.Contains(deviceType, "虚拟机") {
			return errors.New("虚拟设备没有正反面照片")
		}
	}
	result, err := s.db.Exec(`UPDATE `+table+` SET `+column+`=? WHERE project_id=? AND id=? AND deleted_at IS NULL`, dataURL, scope.ProjectID, id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

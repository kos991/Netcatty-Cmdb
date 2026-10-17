package store

import (
	"fmt"
	"regexp"
	"strings"
)

var legacyRackLocation = regexp.MustCompile(`^([^()（）]+?)\s*[（(]([^()（）]+)[）)]$`)
var numericCabinetSeparator = regexp.MustCompile(`([0-9])[－﹣–—]([0-9])`)

var cabinetNumber = regexp.MustCompile(`^[A-Za-z]*[0-9]+(?:-[0-9]+)*$`)

func normalizeCabinetName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Map(func(r rune) rune {
		if r >= '０' && r <= '９' {
			return '0' + r - '０'
		}
		return r
	}, value)
	// Run twice so adjacent separators (1－2－3) also normalize.
	value = numericCabinetSeparator.ReplaceAllString(value, "$1-$2")
	return numericCabinetSeparator.ReplaceAllString(value, "$1-$2")
}

func isRoomLocation(value string) bool {
	return strings.HasSuffix(value, "机房") || strings.HasSuffix(value, "房间") || strings.HasSuffix(value, "数据中心")
}

// Only an explicit room(cabinet) with a cabinet label/number is split.
// Parentheses in other names do not identify a physical cabinet.
func parseRackLocation(value string) (room, cabinet string, combined bool, err error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", "", false, nil
	}
	if match := legacyRackLocation.FindStringSubmatch(value); match != nil {
		room, cabinet = strings.TrimSpace(match[1]), normalizeCabinetName(match[2])
		if !isRoomLocation(room) || !(strings.HasSuffix(cabinet, "柜") || cabinetNumber.MatchString(cabinet)) {
			return "", "", false, fmt.Errorf("位置「%s」无法明确区分机房与机柜", value)
		}
		return room, cabinet, true, nil
	}
	if strings.ContainsAny(value, "()（）") {
		return "", "", false, fmt.Errorf("位置「%s」括号不明确，需手工确认", value)
	}
	if isRoomLocation(value) {
		return value, "", false, nil
	}
	return "", normalizeCabinetName(value), false, nil
}

type RackLocationFields struct {
	DataCenter  string `json:"data_center"`
	CabinetName string `json:"cabinet_name"`
	CabinetPos  string `json:"cabinet_pos"`
}

func canonicalRackLocation(before RackLocationFields) (RackLocationFields, error) {
	after := RackLocationFields{DataCenter: strings.TrimSpace(before.DataCenter)}
	merge := func(value string) error {
		room, cabinet, _, err := parseRackLocation(value)
		if err != nil {
			return err
		}
		if room != "" {
			if after.DataCenter != "" && after.DataCenter != room {
				return fmt.Errorf("现有机房「%s」与位置解析机房「%s」冲突", after.DataCenter, room)
			}
			after.DataCenter = room
		}
		if cabinet != "" {
			if after.CabinetName != "" && after.CabinetName != cabinet {
				return fmt.Errorf("机柜「%s」与旧位置机柜「%s」冲突", after.CabinetName, cabinet)
			}
			after.CabinetName = cabinet
		}
		return nil
	}
	if before.DataCenter != "" {
		// An explicitly entered room may itself contain parentheses. Only a
		// fully recognized legacy room(cabinet) is treated as combined data.
		room, cabinet, combined, err := parseRackLocation(before.DataCenter)
		if err == nil && combined {
			after.DataCenter, after.CabinetName = room, cabinet
		}
	}
	cabinetValue := strings.TrimSpace(before.CabinetName)
	prefix := cabinetValue
	if index := strings.IndexAny(prefix, "(（"); index >= 0 {
		prefix = strings.TrimSpace(prefix[:index])
	}
	if after.DataCenter != "" && !isRoomLocation(cabinetValue) && !isRoomLocation(prefix) {
		// Canonical room + cabinet fields are authoritative, not legacy prose.
		cabinet := normalizeCabinetName(cabinetValue)
		if after.CabinetName != "" && cabinet != "" && after.CabinetName != cabinet {
			return after, fmt.Errorf("机柜「%s」与旧位置机柜「%s」冲突", after.CabinetName, cabinet)
		}
		if cabinet != "" {
			after.CabinetName = cabinet
		}
	} else if err := merge(before.CabinetName); err != nil {
		return after, err
	}
	if value := strings.TrimSpace(before.CabinetPos); value != "" {
		_, cabinet, combined, err := parseRackLocation(value)
		if err != nil {
			return after, err
		}
		if !combined && cabinet != "" && !strings.HasSuffix(cabinet, "柜") && !cabinetNumber.MatchString(cabinet) {
			return after, fmt.Errorf("旧位置「%s」不能明确识别为机柜，需手工确认", value)
		}
	}
	if err := merge(before.CabinetPos); err != nil {
		return after, err
	}
	return after, nil
}

func qualifiedRackLocation(room, cabinet string) string {
	if room == "" {
		return cabinet
	}
	return room + " (" + cabinet + ")"
}

// All asset ingestion paths use this normalization. Canonical start_u wins on
// replacement, including zero; legacy-only inserts can retain u_start.
func normalizeAssetRackLocation(a *CmdbAsset, legacyInsert bool) error {
	after, err := canonicalRackLocation(RackLocationFields{a.DataCenter, a.CabinetName, a.CabinetPos})
	if err != nil {
		return err
	}
	a.DataCenter, a.CabinetName, a.CabinetPos = after.DataCenter, after.CabinetName, ""
	if legacyInsert && a.StartU == 0 && a.UStart > 0 {
		a.StartU = a.UStart
	}
	a.UStart = a.StartU
	return nil
}

func normalizeRackChanges(cur *CmdbAsset, changes CmdbAssetChanges) (CmdbAssetChanges, error) {
	before := RackLocationFields{cur.DataCenter, cur.CabinetName, cur.CabinetPos}
	if changes.DataCenter != nil {
		before.DataCenter = *changes.DataCenter
	}
	if changes.CabinetName != nil {
		before.CabinetName = *changes.CabinetName
		before.CabinetPos = ""
	}
	after, err := canonicalRackLocation(before)
	if err != nil {
		return changes, err
	}
	changes.DataCenter = &after.DataCenter
	changes.CabinetName = &after.CabinetName
	start := cur.StartU
	if changes.StartU != nil {
		start = *changes.StartU
	}
	if after.CabinetName == "" && cur.CabinetName != "" && changes.StartU == nil {
		start = 0
	}
	changes.StartU = &start
	return changes, nil
}

func validateSnapshotRackLocations(records []map[string]any) error {
	for _, record := range records {
		before := rackFields(record)
		after, err := canonicalRackLocation(before)
		if err != nil {
			return fmt.Errorf("同步资产 %s 位置不明确: %w", snapshotString(record["sync_id"]), err)
		}
		if before != after || snapshotInt64(record["start_u"]) != snapshotInt64(record["u_start"]) {
			return fmt.Errorf("同步资产 %s 使用旧机柜位置或不同步的 U 位，请在来源项目预览并迁移后重新导出", snapshotString(record["sync_id"]))
		}
	}
	return nil
}

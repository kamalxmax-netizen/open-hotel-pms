export type BoardRoomStatus = "available" | "reserved" | "dirty" | "cleaning" | "approved" | "closed";

export interface BoardRoomItem {
  roomNumber: string;
  roomType: string;
  sellable: boolean;
  status: BoardRoomStatus;
  note?: string;
}

export interface BoardLane {
  id: string;
  floorLabel: string;
  laneLabel: string;
  showCorridorBelow: boolean;
  rooms: BoardRoomItem[];
}

function room(
  roomNumber: string,
  roomType: string,
  sellable: boolean,
  status: BoardRoomStatus,
  note?: string
): BoardRoomItem {
  return { roomNumber, roomType, sellable, status, note };
}

export function getBoardLanes(): BoardLane[] {
  return [
    {
      id: "f2-a",
      floorLabel: "Floor 2",
      laneLabel: "Wing A",
      showCorridorBelow: true,
      rooms: [
        room("202", "Twin Standard", true, "available"),
        room("204", "Twin Standard", true, "reserved"),
        room("206", "Triple Beds", true, "dirty"),
        room("210", "Deluxe Twin", true, "cleaning"),
        room("212", "Closed Room", false, "closed", "Renovation"),
        room("214", "Closed Room", false, "closed", "Renovation"),
        room("216", "Closed Room", false, "closed", "Renovation"),
        room("218", "Closed Room", false, "closed", "Renovation"),
        room("220", "Closed Room", false, "closed", "Renovation"),
        room("222", "Closed Room", false, "closed", "Renovation"),
        room("224", "Closed Room", false, "closed", "Renovation"),
        room("226", "Closed Room", false, "closed", "Renovation")
      ]
    },
    {
      id: "f2-b",
      floorLabel: "Floor 2",
      laneLabel: "Wing B",
      showCorridorBelow: false,
      rooms: [
        room("250", "Closed Room", false, "closed", "Renovation"),
        room("248", "Closed Room", false, "closed", "Renovation"),
        room("246", "Junior Suite", true, "available"),
        room("242", "Deluxe Queen", true, "reserved"),
        room("240", "Closed Room", false, "closed", "Renovation"),
        room("238", "Twin Standard", true, "available"),
        room("236", "Twin Standard", true, "available"),
        room("234", "Twin Standard", true, "reserved"),
        room("232", "Twin Standard", true, "available"),
        room("230", "Future Inventory", false, "closed", "Not active in sellable map"),
        room("228", "Twin Standard", true, "approved")
      ]
    },
    {
      id: "f3-a",
      floorLabel: "Floor 3",
      laneLabel: "Main Wing",
      showCorridorBelow: true,
      rooms: [
        room("302", "Double Standard", true, "available"),
        room("304", "Closed Room", false, "closed", "Renovation"),
        room("306", "Junior Suite", true, "dirty"),
        room("310", "Deluxe Queen", true, "available"),
        room("312", "Closed Room", false, "closed", "Renovation"),
        room("314", "Double Standard", true, "available"),
        room("316", "Double Standard", true, "available"),
        room("318", "Double Standard", true, "reserved"),
        room("320", "Double Standard", true, "available"),
        room("322", "Closed Room", false, "closed", "Renovation"),
        room("324", "Closed Room", false, "closed", "Renovation"),
        room("326", "Closed Room", false, "closed", "Renovation")
      ]
    },
    {
      id: "f1-a",
      floorLabel: "Floor 1",
      laneLabel: "Main Wing",
      showCorridorBelow: false,
      rooms: [
        room("350", "Closed Room", false, "closed", "Renovation"),
        room("348", "Closed Room", false, "closed", "Renovation"),
        room("346", "Triple Beds", true, "available"),
        room("342", "Deluxe Twin", true, "available"),
        room("340", "Closed Room", false, "closed", "Renovation"),
        room("338", "Closed Room", false, "closed", "Renovation"),
        room("336", "Closed Room", false, "closed", "Renovation"),
        room("334", "Closed Room", false, "closed", "Renovation"),
        room("106", "Family Room", true, "reserved"),
        room("108", "Family Room", true, "available"),
        room("110", "Future Inventory", false, "closed", "Not active in sellable map")
      ]
    }
  ];
}

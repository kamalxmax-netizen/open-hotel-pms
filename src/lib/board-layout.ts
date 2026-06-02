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

// Generic demo layout. Replace with your own property's room map.
export function getBoardLanes(): BoardLane[] {
  return [
    {
      id: "f1-a",
      floorLabel: "Floor 1",
      laneLabel: "Wing A",
      showCorridorBelow: true,
      rooms: [
        room("101", "Twin Standard", true, "available"),
        room("102", "Twin Standard", true, "reserved"),
        room("103", "Double Standard", true, "dirty"),
        room("104", "Double Standard", true, "cleaning"),
        room("105", "Deluxe Twin", true, "available"),
        room("106", "Deluxe Queen", true, "approved"),
        room("107", "Family Room", true, "available"),
        room("108", "Closed Room", false, "closed", "Maintenance")
      ]
    },
    {
      id: "f2-a",
      floorLabel: "Floor 2",
      laneLabel: "Wing A",
      showCorridorBelow: true,
      rooms: [
        room("201", "Twin Standard", true, "available"),
        room("202", "Twin Standard", true, "reserved"),
        room("203", "Double Standard", true, "available"),
        room("204", "Deluxe Twin", true, "dirty"),
        room("205", "Junior Suite", true, "available"),
        room("206", "Triple Beds", true, "cleaning"),
        room("207", "Deluxe Queen", true, "reserved"),
        room("208", "Family Room", true, "available")
      ]
    },
    {
      id: "f2-b",
      floorLabel: "Floor 2",
      laneLabel: "Wing B",
      showCorridorBelow: false,
      rooms: [
        room("209", "Double Standard", true, "available"),
        room("210", "Double Standard", true, "approved"),
        room("211", "Junior Suite", true, "available"),
        room("212", "Closed Room", false, "closed", "Maintenance")
      ]
    }
  ];
}

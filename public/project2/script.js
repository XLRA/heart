var moves = 0;
var time = 0;
var timer;
var won = false;

window.onload = function() {
  newGame();
}

function swapTiles(cell1, cell2) {
  var temp = document.getElementById(cell1).className;
  document.getElementById(cell1).className = document.getElementById(cell2).className;
  document.getElementById(cell2).className = temp;
}

// puts all the tiles back in order
function orderTiles() {
  for (var row = 1; row <= 4; row++) {
    for (var column = 1; column <= 4; column++) {
      document.getElementById("cell" + row + column).className = "tile" + ((row - 1) * 4 + column);
    }
  }
}

function shuffle() {
  orderTiles();

  // move the empty tile around randomly a bunch of times
  // (randomly placing the tiles can make a puzzle that cant be solved)
  var emptyRow = 4;
  var emptyCol = 4;
  for (var i = 0; i < 300; i++) {
    var r = emptyRow;
    var c = emptyCol;
    var dir = Math.floor(Math.random() * 4);
    if (dir == 0) r--;
    else if (dir == 1) r++;
    else if (dir == 2) c--;
    else c++;

    if (r >= 1 && r <= 4 && c >= 1 && c <= 4) {
      swapTiles("cell" + emptyRow + emptyCol, "cell" + r + c);
      emptyRow = r;
      emptyCol = c;
    }
  }
}

function startTimer() {
  clearInterval(timer);
  time = 0;
  document.getElementById("time").innerHTML = time;
  timer = setInterval(function() {
    time++;
    document.getElementById("time").innerHTML = time;
  }, 1000);
}

function newGame() {
  shuffle();
  moves = 0;
  won = false;
  document.getElementById("moves").innerHTML = moves;
  startTimer();
}

function simpleGame() {
  orderTiles();
  swapTiles("cell43", "cell44"); // only 15 is out of place
  moves = 0;
  won = false;
  document.getElementById("moves").innerHTML = moves;
  startTimer();
}

function clickTile(row, column) {
  if (won) return;

  var cell = "cell" + row + column;
  var tile = document.getElementById(cell).className;

  if (tile != "tile16") {
    // check if the empty tile is on the right
    if (column < 4) {
      if (document.getElementById("cell" + row + (column + 1)).className == "tile16") {
        swapTiles(cell, "cell" + row + (column + 1));
        tileMoved();
        return;
      }
    }
    // check if the empty tile is on the left
    if (column > 1) {
      if (document.getElementById("cell" + row + (column - 1)).className == "tile16") {
        swapTiles(cell, "cell" + row + (column - 1));
        tileMoved();
        return;
      }
    }
    // check if the empty tile is above
    if (row > 1) {
      if (document.getElementById("cell" + (row - 1) + column).className == "tile16") {
        swapTiles(cell, "cell" + (row - 1) + column);
        tileMoved();
        return;
      }
    }
    // check if the empty tile is below
    if (row < 4) {
      if (document.getElementById("cell" + (row + 1) + column).className == "tile16") {
        swapTiles(cell, "cell" + (row + 1) + column);
        tileMoved();
        return;
      }
    }
  }
}

function tileMoved() {
  moves++;
  document.getElementById("moves").innerHTML = moves;

  if (checkWin()) {
    won = true;
    clearInterval(timer);
    setTimeout(() => {Win()}, 500); // so the last tile shows before the alert
  }
}

function checkWin() {
  for (var row = 1; row <= 4; row++) {
    for (var column = 1; column <= 4; column++) {
      if (document.getElementById("cell" + row + column).className != "tile" + ((row - 1) * 4 + column)) {
        return false;
      }
    }
  }
  return true;
}

function Win() {
  if (confirm("Congratulations!! You solved the puzzle!\n\nNumber of moves: " + moves + "\nTime: " + time + " seconds\n\nWould you like to play again?")) {
    newGame();
  }
}

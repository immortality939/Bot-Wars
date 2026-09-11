import fs from "fs";

const FILE = "./players.json";


// Load all players
function loadPlayers() {
    if (!fs.existsSync(FILE)) {
        fs.writeFileSync(FILE, "[]");
    }

    const data = fs.readFileSync(FILE, "utf8");

    return JSON.parse(data);
}


// Save all players
function savePlayers(players) {
    fs.writeFileSync(
        FILE,
        JSON.stringify(players, null, 2)
    );
}


// Create new account
export function createPlayer(username, password, email) {

    let players = loadPlayers();

    // Check existing username
    let exists = players.find(
        p => p.username === username
    );

    if (exists) {
        return {
            success:false,
            message:"Username already exists"
        };
    }


    let newPlayer = {

        username,
        password,
        email,

        verified:false,


        // Game data
        level:1,
        xp:0,
        coins:100,


        // Last position
        map:"start",
        x:500,
        y:300,


        inventory:[]

    };


    players.push(newPlayer);

    savePlayers(players);


    return {
        success:true,
        message:"Account created",
        player:newPlayer
    };

}



// Login player
export function loginPlayer(username,password){

    let players = loadPlayers();


    let player = players.find(
        p =>
        p.username === username &&
        p.password === password
    );


    if(!player){

        return {
            success:false,
            message:"Wrong username or password"
        };

    }


    return {
        success:true,
        player
    };

}



// Save game progress
export function savePlayer(username,data){

    let players = loadPlayers();


    let player = players.find(
        p=>p.username===username
    );


    if(!player){
        return false;
    }


    Object.assign(player,data);


    savePlayers(players);


    return true;

}



// Load player data
export function getPlayer(username){

    let players = loadPlayers();


    return players.find(
        p=>p.username===username
    );

}
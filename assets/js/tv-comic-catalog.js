(function (global) {
  "use strict";

  global.ConcertoAdditionalComics = [
    {
      id: "clocktower",
      label: "Clocktower",
      title: "One more chime.",
      theme: "arch",
      portraitBeat: 4,
      sounds: {"2": "DONG", "3": "CREEAK"},
      cue: [
        "Town clock’s five minutes slow. That’s why we all get to be late together.",
        "The clock’s stopped. The bell hasn’t.",
        "Look at that swing. It’s winding up for an extra one.",
        "Twelve was plenty, thanks.",
        "At dawn, the clock starts again. First in the report is [Name]."
      ],
      survive: "[Name] survived. They’re setting their own alarm from now on.",
      death: "[Name] IS DEAD"
    },
    {
      id: "snowman-stack",
      label: "Snowman Stack",
      title: "The tallest snowman.",
      theme: "bus",
      portraitBeat: 4,
      sounds: {"2": "PLOP", "3": "WOBBLE"},
      cue: [
        "They asked for a snowman. Nobody said how many floors.",
        "The top snowball’s leaning. His hat’s already made up its mind.",
        "There goes the carrot. Lovely little throw, that.",
        "I’d take one ball off the top. Might be a bit late now.",
        "First light. The carrot’s halfway down the street. Here’s what we know about [Name]."
      ],
      survive: "[Name] survived. Next year, the snowman gets a height limit.",
      death: "[Name] IS DEAD"
    },
    {
      id: "post-office",
      label: "Post Office",
      title: "Christmas post.",
      theme: "bakery",
      portraitBeat: 4,
      sounds: {"2": "FWIP", "3": "CLACK"},
      cue: [
        "The post office is down to one last sack. It’s doing a lot of work.",
        "Look, the sorting cart’s moving. Someone’s gone in to see.",
        "The sack’s through the door. Here come the envelopes.",
        "And down comes the shutter. We’ll ask about the cart in the morning.",
        "The shutters go up. The clerk’s first report is on [Name]."
      ],
      survive: "[Name] survived. They’d like everything sent flat from now on.",
      death: "[Name] IS DEAD"
    },
    {
      id: "skate-rink",
      label: "Skate Rink",
      title: "Last lap.",
      theme: "sled",
      portraitBeat: 4,
      sounds: {"2": "SHHH", "3": "TINKLE"},
      cue: [
        "The rink’s closed. The skate rack didn’t get the memo.",
        "Someone’s reached the turnstile. It won’t turn.",
        "There goes the rack past the far side. It’s coming round again.",
        "Lovely turn. We’d like the exit, please.",
        "Someone unlocks the rink at first light. We’ve had word about [Name]."
      ],
      survive: "[Name] survived. They’re giving the rack its own lane next time.",
      death: "[Name] IS DEAD"
    },
    {
      id: "market-cart",
      label: "Market Cart",
      title: "Sprouts by the cartload.",
      theme: "bakery",
      portraitBeat: 4,
      sounds: {"2": "PLOP", "3": "RUMBLE"},
      cue: [
        "Look at that cart. We’ll be eating sprouts till February.",
        "One wheel’s found a dip in the cobbles.",
        "There goes the first sprout. The rest are queuing at the edge.",
        "Well, that’s saved somebody a bit of unpacking.",
        "By dawn, there are sprouts in every gutter. The next name we hear is [Name]."
      ],
      survive: "[Name] survived. They’ll have their sprouts delivered one at a time.",
      death: "[Name] IS DEAD"
    },
    {
      id: "toy-train",
      label: "Toy Train",
      title: "The Christmas Express.",
      theme: "sled",
      portraitBeat: 4,
      sounds: {"2": "CHUFF", "3": "TOOT"},
      cue: [
        "They said the toy train does one lap. Usually.",
        "The little engine’s picked up speed. There’s a hat on the platform.",
        "The train’s gone into the tunnel. Watch that far opening.",
        "There it goes. The hat’s still waiting for the slow one.",
        "The little train’s back at the platform. The morning report starts with [Name]."
      ],
      survive: "[Name] survived. A train with a timetable would be nice next time.",
      death: "[Name] IS DEAD"
    },
    {
      id: "ribbon-reel",
      label: "Ribbon Reel",
      title: "A little extra ribbon.",
      theme: "arch",
      portraitBeat: 4,
      sounds: {"2": "ZZZIP", "3": "FLAP"},
      cue: [
        "We asked for enough ribbon for two presents.",
        "The reel’s gone between the posts. Someone’s waiting to get past.",
        "The loose end’s wrapped right across the lane.",
        "That’s a very festive way to close the square.",
        "Daylight catches a strip of ribbon across the square. Word’s come in about [Name]."
      ],
      survive: "[Name] survived. Their presents are getting paper bags this year.",
      death: "[Name] IS DEAD"
    },
    {
      id: "snowplough",
      label: "Snowplough",
      title: "The little snowplough.",
      theme: "bus",
      portraitBeat: 4,
      sounds: {"2": "PUT-PUT", "3": "FWOOSH"},
      cue: [
        "They sent the little plough. Very good on the little roads.",
        "That drift’s bigger than the plough.",
        "A boot’s vanished behind the wall. Here comes the snow.",
        "We’ll give the road a minute to reappear.",
        "Morning. The road’s clear enough to see again. There’s news about [Name]."
      ],
      survive: "[Name] survived. They’d like a plough that can see over the snow.",
      death: "[Name] IS DEAD"
    },
    {
      id: "tower-of-pies",
      label: "Tower of Pies",
      title: "The mince-pie tower.",
      theme: "bakery",
      portraitBeat: 4,
      sounds: {"2": "TAP", "3": "CLICK"},
      cue: [
        "The bakery’s made a tower of mince pies. One has its own saucer.",
        "The stack leans. That one on the saucer stays exactly where it is.",
        "Someone’s picked the one on the saucer. There’s no label.",
        "I’d ask the baker what the special is. The lights have just gone out.",
        "The baker opens at first light. The saucer’s still there. Here’s the report on [Name]."
      ],
      survive: "[Name] survived. They’re ordering toast tomorrow.",
      death: "[Name] IS DEAD"
    },
    {
      id: "carol-organ",
      label: "Carol Organ",
      title: "One more verse.",
      theme: "bus",
      portraitBeat: 4,
      sounds: {"2": "PARP", "3": "CLICK"},
      cue: [
        "The street organ has been playing the same carol since lunch.",
        "It’s stopped out here. Now you can hear it through that door.",
        "Someone went to have a look. The handle’s still turning out here.",
        "There goes the door. I think that’s the end of the verse.",
        "Morning comes. For once the street is quiet. We’ve had word about [Name]."
      ],
      survive: "[Name] survived. They’d be fine with one verse next year.",
      death: "[Name] IS DEAD"
    },
    {
      id: "lantern-parade",
      label: "Lantern Parade",
      title: "The big lantern.",
      theme: "arch",
      portraitBeat: 4,
      sounds: {"3": "SWOOSH"},
      cue: [
        "The parade ordered the large lantern. This is apparently the medium.",
        "The wind’s giving it a little push.",
        "Look at the light travel all the way across the square.",
        "Right. The lantern’s leading the parade now.",
        "Sun’s up. They’re bringing the lantern back to the square. The next report is on [Name]."
      ],
      survive: "[Name] survived. Next year the lantern can get its own parade permit.",
      death: "[Name] IS DEAD"
    },
    {
      id: "sleigh-bells",
      label: "Sleigh Bells",
      title: "Mind the bells.",
      theme: "sled",
      portraitBeat: 4,
      sounds: {"2": "JING", "3": "JANGLE"},
      cue: [
        "The shop’s got a bell for every customer. They’ve all come in at once.",
        "Someone’s gone behind the curtain. You can hear them coming down the row.",
        "There’s one last jingle. Everything’s gone very still.",
        "Hello? The shop usually says goodbye as well.",
        "The shop opens in daylight. The clerk’s first note is about [Name]."
      ],
      survive: "[Name] survived. They’d like to shop in the quiet aisle.",
      death: "[Name] IS DEAD"
    },
    {
      id: "ornament-shop",
      label: "Ornament Shop",
      title: "The runaway bauble.",
      theme: "bakery",
      portraitBeat: 4,
      sounds: {"2": "WOOO", "3": "SWISH"},
      cue: [
        "The shop says that one’s for the tree. Supposedly.",
        "It’s rolled out of its stand and found the doorway.",
        "Look at that. It’s picked up the whole street in its reflection.",
        "It’s having a quick look round before it goes on the tree.",
        "At daybreak, the shopkeeper rolls the bauble inside. Now for the news on [Name]."
      ],
      survive: "[Name] survived. The bauble’s getting its own parking space.",
      death: "[Name] IS DEAD"
    },
    {
      id: "hot-cocoa",
      label: "Hot Cocoa",
      title: "One mug each.",
      theme: "bus",
      portraitBeat: 4,
      sounds: {"2": "CLINK", "3": "TINK"},
      cue: [
        "The cocoa stand’s put out enough mugs for a choir.",
        "The top cups have shifted. There’s a mug tucked away behind them.",
        "Someone’s picking that one. The tag’s turned all the way round.",
        "They’ve gone behind the stall to try it. We’ll leave them to it.",
        "Daylight reaches the cocoa stand. The first update is about [Name]."
      ],
      survive: "[Name] survived. They’ll have tea in a very ordinary cup.",
      death: "[Name] IS DEAD"
    },
    {
      id: "gift-wrap",
      label: "Gift Wrap",
      title: "The biggest roll.",
      theme: "sled",
      portraitBeat: 4,
      sounds: {"2": "RRRROLL", "3": "FWIP"},
      cue: [
        "The stationer had an enormous parcel waiting by the bench.",
        "The broad paper roll’s started moving. There goes the end.",
        "The sheet covers the whole bench for a second.",
        "And the parcel’s gone. The bench is still here.",
        "By morning, someone’s found the loose end of the paper. We’ve got word on [Name]."
      ],
      survive: "[Name] survived. They’re asking for unwrapped presents this year.",
      death: "[Name] IS DEAD"
    },
    {
      id: "frozen-fountain",
      label: "Frozen Fountain",
      title: "The fountain on ice.",
      theme: "arch",
      portraitBeat: 4,
      sounds: {"2": "CREAK", "3": "TING"},
      cue: [
        "They’ve turned the frozen fountain into a sculpture. Very proud of it.",
        "The ice has started to lean. Even the little flakes are hanging in the air.",
        "There’s a blue flash and the whole fountain stops mid-tilt.",
        "I think we’ve just seen a fountain forget to fall.",
        "First light catches the fountain exactly where we left it. Here’s the news about [Name]."
      ],
      survive: "[Name] survived. They’re waiting until spring to compliment the sculpture.",
      death: "[Name] IS DEAD"
    },
    {
      id: "candy-cane-sign",
      label: "Candy Cane Sign",
      title: "The sweet shop sign.",
      theme: "bakery",
      portraitBeat: 4,
      sounds: {"2": "CREAK", "3": "CLICK"},
      cue: [
        "The sweet shop said to follow the big candy cane. There it is.",
        "It’s turned halfway round. That’s a different door entirely.",
        "Someone’s following the sign. That door hasn’t got a shop window.",
        "And now the sign’s swung back. Great timing.",
        "At sunrise, the sweet shop puts the sign straight. We’ve got news about [Name]."
      ],
      survive: "[Name] survived. Next time they’re checking the street number.",
      death: "[Name] IS DEAD"
    },
    {
      id: "holiday-cracker",
      label: "Holiday Cracker",
      title: "One giant cracker.",
      theme: "arch",
      portraitBeat: 4,
      sounds: {"2": "POP", "3": "FLUFF"},
      cue: [
        "There was a bit of paper left, so they made one enormous cracker.",
        "The middle’s coming apart. I hope they’ve put a decent joke in it.",
        "There goes the paper crown. That’s going to fit somebody.",
        "All confetti. Still no sign of the joke.",
        "The street sweeper’s out picking up confetti. The morning report is about [Name]."
      ],
      survive: "[Name] survived. The paper crown might do for breakfast.",
      death: "[Name] IS DEAD"
    },
    {
      id: "stocking-line",
      label: "Stocking Line",
      title: "Stockings on the line.",
      theme: "arch",
      portraitBeat: 4,
      sounds: {"2": "FLOP", "3": "SWISH"},
      cue: [
        "The whole street’s hung its stockings together. Lovely idea.",
        "The line’s dipped across the lane. The path looked clear a second ago.",
        "Those socks have made an entire curtain. You can’t see the other side.",
        "That’s a very festive way of closing a street.",
        "By morning, the stockings are back above the lane. We’ve heard about [Name]."
      ],
      survive: "[Name] survived. They’d like everyone to hang their socks indoors.",
      death: "[Name] IS DEAD"
    },
    {
      id: "tinsel-spool",
      label: "Tinsel Spool",
      title: "Glitter on the balcony.",
      theme: "bus",
      portraitBeat: 4,
      sounds: {"2": "SSSHH", "3": "FLURR"},
      cue: [
        "We left one box of tinsel on the balcony. Thought we’d get it later.",
        "There’s a silver bit peeking out of the lid.",
        "Now it’s pouring over the rail like a whole curtain.",
        "I’ll get the box. The tinsel seems quite busy.",
        "Daylight catches silver strands all down the railing. Here’s the report on [Name]."
      ],
      survive: "[Name] survived. They’re leaving the glitter to the tree next year.",
      death: "[Name] IS DEAD"
    },
    {
      id: "cracker-boxes",
      label: "Cracker Boxes",
      title: "Stacked for Christmas.",
      theme: "bakery",
      portraitBeat: 4,
      sounds: {"2": "WOBBLE", "3": "SHUFF"},
      cue: [
        "The shop made a tidy little tower from all the cracker boxes.",
        "I don’t know if the top box can even see the bottom box from there.",
        "There’s the lean. The gift bows are all going the same way.",
        "Right. We’re doing a shelf next year.",
        "The shop opens in daylight. The boxes are back on the floor. We have news of [Name]."
      ],
      survive: "[Name] survived. They’ve suggested a shelf. A low one.",
      death: "[Name] IS DEAD"
    },
    {
      id: "cookie-trolley",
      label: "Cookie Trolley",
      title: "The last tray.",
      theme: "sled",
      portraitBeat: 4,
      sounds: {"2": "RRR", "3": "SWISH"},
      cue: [
        "The cookie trolley’s parked by the bakery door. This bit usually goes smoothly.",
        "There it goes. Someone’s stepped back into the doorway.",
        "It’s taken the ramp. The biscuits are staying beautifully level.",
        "The trolley can clear its own table at that speed.",
        "At dawn, the trolley’s back by the door. Here’s what we’ve heard about [Name]."
      ],
      survive: "[Name] survived. They’ll have their biscuits from a stationary plate.",
      death: "[Name] IS DEAD"
    },
    {
      id: "pudding-mould",
      label: "Pudding Mould",
      title: "The chef’s surprise.",
      theme: "bakery",
      portraitBeat: 4,
      sounds: {"2": "CLINK", "3": "WOBBLE"},
      cue: [
        "The chef’s brought out the big pudding. It’s still wobbling from the mould.",
        "There’s a single spoon on the platter. Someone’s about to try it.",
        "They’ve taken the spoon behind the counter. Everyone’s waiting for a verdict.",
        "The chef’s looking very pleased. I’d like a second opinion.",
        "The chef’s back at first light. Our first update is about [Name]."
      ],
      survive: "[Name] survived. They’re claiming the right to skip dessert.",
      death: "[Name] IS DEAD"
    },
    {
      id: "mistletoe-mobile",
      label: "Mistletoe Mobile",
      title: "The mistletoe prize.",
      theme: "arch",
      portraitBeat: 4,
      sounds: {"2": "FLIP", "3": "CLICK"},
      cue: [
        "The mistletoe display promises a little prize. The display’s very big.",
        "The branches swing past a gold ticket. Someone’s spotted it.",
        "There goes the ticket down the prize chute. Somebody’s reached for it.",
        "The little prize door’s closed. I think you’ve got to be quick at this.",
        "Morning. Someone opens the prize hatch. The next report is on [Name]."
      ],
      survive: "[Name] survived. They’ve decided the prize can roll over.",
      death: "[Name] IS DEAD"
    },
    {
      id: "tree-topper",
      label: "Tree Topper",
      title: "Star in the wind.",
      theme: "arch",
      portraitBeat: 4,
      sounds: {"2": "WHOO", "3": "FLAP"},
      cue: [
        "We picked a very big star for the tree. It’s on top for now.",
        "There’s a gust and the whole star turns edge-on.",
        "It’s caught the wind. I think we’ve bought a kite.",
        "There it goes over the rooftops. The tree’s standing by.",
        "Sun’s up over the rooftops. The tree’s still waiting for its star. Here’s news of [Name]."
      ],
      survive: "[Name] survived. They’ve voted for a smaller star.",
      death: "[Name] IS DEAD"
    },
    {
      id: "rooftop-reindeer",
      label: "Rooftop Reindeer",
      title: "An early departure.",
      theme: "sled",
      portraitBeat: 4,
      sounds: {"2": "CREEAK", "3": "SHFF"},
      cue: [
        "That’s the painted wooden reindeer from the display. They’ve put it on a roof.",
        "Somebody’s sat on it. Fair play, I’ve always wanted a go.",
        "The whole decoration’s sliding out of its spot.",
        "That’s quite a ride for something from the window display.",
        "At first light, the roof is empty. We’ve had word about [Name]."
      ],
      survive: "[Name] survived. Next year they’re keeping both feet on the pavement.",
      death: "[Name] IS DEAD"
    },
    {
      id: "frozen-laundry",
      label: "Frozen Laundry",
      title: "A shortcut through the washing.",
      theme: "bus",
      portraitBeat: 4,
      sounds: {"2": "FLAP", "3": "FLOP"},
      cue: [
        "The washing’s frozen solid. Still on the line, though.",
        "The wind’s turned all the jumpers across the walkway.",
        "Someone’s gone into the gap. The jumpers have swung again.",
        "Can you see the end of the lane? All I can see is sleeves.",
        "In daylight, there’s a way through the jumpers again. We have news of [Name]."
      ],
      survive: "[Name] survived. They’ll trust an indoor drying rack from now on.",
      death: "[Name] IS DEAD"
    },
    {
      id: "skating-snow-globe",
      label: "Skating Snow Globe",
      title: "The travelling snow globe.",
      theme: "sled",
      portraitBeat: 4,
      sounds: {"2": "WHIRR", "3": "SWISH"},
      cue: [
        "They brought a giant snow globe to the rink. It was meant to sit by the gate.",
        "It’s rolling. The little village inside has noticed as well.",
        "Look, it’s carried the lost-property hat along with it.",
        "Over the line and through the gate. There goes the neighbourhood.",
        "Morning comes. The globe’s outside the rink. There’s an update on [Name]."
      ],
      survive: "[Name] survived. They’re still waiting for the hat to finish its lap.",
      death: "[Name] IS DEAD"
    },
    {
      id: "bakery-bellows",
      label: "Bakery Bellows",
      title: "A little flour.",
      theme: "bakery",
      portraitBeat: 4,
      sounds: {"2": "PUFF", "3": "FOOF"},
      cue: [
        "Someone’s tidying the bakery counter. There’s a bit of flour left.",
        "The bellows give one puff. That’s a very white window.",
        "Someone in an apron crosses through the cloud. Now the whole shop’s gone white.",
        "Look, the cloud’s lifting. All I can see is the apron on its hook.",
        "The bakery window’s clear at first light. Word has come in about [Name]."
      ],
      survive: "[Name] survived. They’ve asked for tomorrow’s rolls with a little less flour.",
      death: "[Name] IS DEAD"
    },
    {
      id: "gingerbread-wall",
      label: "Gingerbread Wall",
      title: "The gingerbread door.",
      theme: "bus",
      portraitBeat: 4,
      sounds: {"2": "CREEK", "3": "CLICK"},
      cue: [
        "The display’s got a little gingerbread house. That wall’s moving.",
        "There’s a proper door behind it. Someone’s gone to have a look.",
        "Behind the gingerbread door, the hallway is already closing.",
        "There’s a click. All we can see from the street is a very polite gingerbread wall.",
        "At daylight, someone props open the door. The next update is about [Name]."
      ],
      survive: "[Name] survived. They’ll be using doors without icing from now on.",
      death: "[Name] IS DEAD"
    },
    {
      id: "choir-platform",
      label: "Choir Platform",
      title: "The folding stage.",
      theme: "sled",
      portraitBeat: 4,
      sounds: {"2": "SQUEAK", "3": "SHUFF"},
      cue: [
        "The choir’s finished. Somebody’s still collecting the music sheets.",
        "The top step’s moved. It’s a folding platform, apparently.",
        "The curtains have swung back across. The sheet music’s still in a pile.",
        "We’ll leave the stage where it is until someone finds the lights.",
        "The sun’s up and the music sheets are still there. We’ve heard about [Name]."
      ],
      survive: "[Name] survived. Next year they’re booking a stage with no moving parts.",
      death: "[Name] IS DEAD"
    },
    {
      id: "knitted-scarf",
      label: "The scarf stall",
      title: "The scarf stall",
      theme: "arch",
      portraitBeat: 1,
      sounds: {"2": "SHFF", "3": "FWUMP!"},
      cue: [
        "The market closes, but someone’s left the giant display scarf out.",
        "[Name] takes the shortcut past the stall. The scarf trails nearly to the ground.",
        "The loose end rolls across the snow. The other end is already across the doorway.",
        "One tug, and the whole entrance vanishes behind wool.",
        "By daylight, the shopkeeper has a lot of scarf to put back."
      ],
      survive: "Somehow [Name] made it to breakfast. They could use a warm drink.",
      death: "At breakfast, there was one missing guest. [Name] was dead."
    },
    {
      id: "toy-drum",
      label: "The drum on the hill",
      title: "The drum on the hill",
      theme: "sled",
      portraitBeat: 1,
      sounds: {"2": "TUM", "3": "BOOM!"},
      cue: [
        "Somebody left the parade drum at the top of a rather steep street.",
        "[Name] takes one look at the drum. Then it takes one look at the hill.",
        "The first roll is slow enough to count.",
        "Then it comes round the bend a little faster than a drum ought to.",
        "Morning comes. The band is one drum short."
      ],
      survive: "[Name] beat it to the bottom. Good thing they knew the shortcut.",
      death: "Word came back after dawn. [Name] was dead."
    },
    {
      id: "festival-banner",
      label: "The last banner",
      title: "The last banner",
      theme: "arch",
      portraitBeat: 1,
      sounds: {"2": "FLAP", "3": "FWAP!"},
      cue: [
        "They hung one more banner across the festival alley.",
        "[Name] walks through after the shops close. There’s still a light on at the far end.",
        "The banner stirs. Then the light disappears.",
        "The whole alley is suddenly one long strip of red cloth.",
        "Back in daylight, the square waits for the clerk to open the book."
      ],
      survive: "[Name] is here. They’d like a street with fewer banners.",
      death: "At first light, the clerk called the name. [Name] was dead."
    },
    {
      id: "whisk-wheel",
      label: "The bakery display",
      title: "The bakery display",
      theme: "bakery",
      portraitBeat: 1,
      sounds: {"2": "WHIRR", "3": "CLICK"},
      cue: [
        "The baker built a clockwork whisk for the front window.",
        "[Name] stops to watch it. They can hear music from the side door.",
        "The whisk keeps turning after the music stops.",
        "The side door swings closed. From the street, all you can see is the whisk.",
        "At dawn, the baker lifts the blind."
      ],
      survive: "There’s [Name], on the other side of the glass, waving.",
      death: "The baker had news when the shop opened. [Name] was dead."
    },
    {
      id: "carriage-lamp",
      label: "The carriage lamp",
      title: "The carriage lamp",
      theme: "bus",
      portraitBeat: 1,
      sounds: {"2": "FLICKER", "3": "FWOOSH"},
      cue: [
        "A carriage sits in the square with one enormous lamp still lit.",
        "[Name] passes the carriage. A voice from inside says their ride is here.",
        "The door opens a crack. The only thing [Name] can see inside is a mitten.",
        "The mitten reaches out. The lamp goes dark, the door slams, and the carriage takes off.",
        "In the morning, there are tracks in the snow and an empty hitching post."
      ],
      survive: "[Name] is back before the carriage. No idea where the driver is.",
      death: "By morning, the square had heard. [Name] was dead."
    },
    {
      id: "punch-fountain",
      label: "The punch fountain",
      title: "The punch fountain",
      theme: "sled",
      portraitBeat: 1,
      sounds: {"2": "GLUG"},
      cue: [
        "The party put out a punch bowl big enough to reflect the whole ceiling.",
        "[Name] fills a cup. Everyone else has gone outside for the carols.",
        "The punch changes colour. It was definitely green when the caterer left.",
        "[Name] lifts the cup. Outside, the caterer starts counting how many cups they brought.",
        "At breakfast, the bowl is empty and the cups are stacked."
      ],
      survive: "[Name] made it through the night. Tea for them today.",
      death: "The first news from the square was about [Name]. They were dead."
    },
    {
      id: "icing-bucket",
      label: "The decorating contest",
      title: "The decorating contest",
      theme: "bakery",
      portraitBeat: 1,
      sounds: {"2": "DIP"},
      cue: [
        "There’s one unmarked pail left on the decorating table.",
        "[Name] is putting the finishing touches on a biscuit house.",
        "They dip one spoon in. The icing looks exactly like the regular batch.",
        "The spoon rises. Cut to the empty judging chairs.",
        "The judges are back at first light. One plate still sits apart."
      ],
      survive: "Here’s [Name]. Anyone got a clean spoon?",
      death: "By morning, the result was clear. [Name] was dead."
    },
    {
      id: "chimney-sweep",
      label: "The sweep’s window",
      title: "The sweep’s window",
      theme: "bus",
      portraitBeat: 1,
      sounds: {"2": "SSHH", "3": "CLICK"},
      cue: [
        "The sweep keeps the brush display in the narrowest shop on the street.",
        "[Name] stops there to look at a coat hanging just inside.",
        "One brush sweeps across the window. The shop light flickers.",
        "The curtain closes from the inside. The street is empty again.",
        "Morning comes. The shop bell rings once."
      ],
      survive: "It’s [Name]. They’re glad to be back outside.",
      death: "The first person in the square brought news. [Name] was dead."
    },
    {
      id: "jam-delivery",
      label: "The jam delivery",
      title: "The jam delivery",
      theme: "bakery",
      portraitBeat: 1,
      sounds: {"2": "POP"},
      cue: [
        "A row of jam jars arrives before the baker does.",
        "[Name] has a spoon and some toast. One jar has no label.",
        "The lid comes off. It smells sweet enough.",
        "[Name] lifts the spoon. The view cuts to the blank label.",
        "At dawn, the baker opens the shop to hear what happened."
      ],
      survive: "[Name] is here. The rest of us can have marmalade.",
      death: "The baker got the news at opening time. [Name] was dead."
    },
    {
      id: "mug-carousel",
      label: "The spinning mugs",
      title: "The spinning mugs",
      theme: "arch",
      portraitBeat: 1,
      sounds: {"2": "TINK", "3": "CLACK"},
      cue: [
        "The market hired a carousel just to serve hot drinks.",
        "[Name] waits while one mug comes round twice.",
        "It looks like every other mug. There’s no name on the handle.",
        "The carousel stops in front of [Name]. In the same moment, the music stops.",
        "In the morning, one mug sits by itself at the end of the counter."
      ],
      survive: "[Name] is here. A glass of water will do.",
      death: "The clerk had one line for the village. [Name] was dead."
    },
    {
      id: "present-crane",
      label: "The workshop crane",
      title: "The workshop crane",
      theme: "bus",
      portraitBeat: 1,
      sounds: {"2": "CREAK", "3": "CLACK"},
      cue: [
        "Late at the workshop, one gift is too big for the shelf.",
        "[Name] heads past as the parcel crosses the street above them.",
        "The parcel fills the window. Someone calls from behind the service door.",
        "The door slides shut behind the parcel. The window goes dark.",
        "At dawn, the workshop opens, one light at a time."
      ],
      survive: "[Name] came back without a parcel. That’s all they’re saying.",
      death: "By morning, the village had heard. [Name] was dead."
    },
    {
      id: "pinecone-basket",
      label: "The overflowing basket",
      title: "The overflowing basket",
      theme: "arch",
      portraitBeat: 1,
      sounds: {"2": "RATTLE", "3": "WHUMP"},
      cue: [
        "The wreath stall has one basket almost as wide as the door.",
        "[Name] spots a light in the covered lane and takes the short way through.",
        "Pinecones spill across the path. Then the basket swings into view.",
        "The light goes out behind it. Cut to the empty square.",
        "At dawn, somebody finally clears the lane."
      ],
      survive: "There’s [Name]. They’ll use the main road next time.",
      death: "The news came at first light. [Name] was dead."
    },
    {
      id: "toy-robot",
      label: "The toy shop’s new model",
      title: "The toy shop’s new model",
      theme: "sled",
      portraitBeat: 1,
      sounds: {"2": "CLONK", "3": "CLONK!"},
      cue: [
        "The toy shop has a display robot as tall as its sign.",
        "[Name] walks past. The robot takes one step after them.",
        "Then it takes another. [Name] starts taking quicker steps.",
        "Its feet flash under the shop light. Cut as [Name] turns the corner.",
        "In daylight, the shop has put the robot back in the window."
      ],
      survive: "[Name] got round the corner ahead of it. They’ll take stairs next time.",
      death: "The shopkeeper opened early with news. [Name] was dead."
    },
    {
      id: "candle-carousel",
      label: "The carousel with no candles",
      title: "The carousel with no candles",
      theme: "bakery",
      portraitBeat: 1,
      sounds: {"2": "CLICK", "3": "WHIRR"},
      cue: [
        "The window carousel starts turning all by itself. Every candle is unlit.",
        "[Name] sees it through the glass and stops for a look.",
        "The shadows go one way. The carousel goes the other.",
        "The shop picture vanishes one piece at a time. Cut to the street.",
        "In the morning, the carousel is still, right where it was."
      ],
      survive: "[Name] made it through. The shopkeeper wants their opinion on the display.",
      death: "By first light, the village knew. [Name] was dead."
    },
    {
      id: "paper-snowflakes",
      label: "The snowflake booth",
      title: "The snowflake booth",
      theme: "sled",
      portraitBeat: 1,
      sounds: {"2": "RUSTLE", "3": "SHFF"},
      cue: [
        "The festival booth has a snowflake big enough to fill the window.",
        "[Name] heads in for a photo. Someone calls from the far curtain.",
        "The paper folds in on itself. The booth is hardly visible anymore.",
        "The curtain drops. From the square, all you can see is white paper.",
        "At first light the square is quiet, and the paper is still."
      ],
      survive: "Here comes [Name]. They didn’t get the photo.",
      death: "The first report from the booth was about [Name]. They were dead."
    }
  ];
})(window);

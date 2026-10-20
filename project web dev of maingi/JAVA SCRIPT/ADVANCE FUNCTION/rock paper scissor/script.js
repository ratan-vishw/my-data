



let computerchoice;
      let result = {
        win: 0,
        losses: 0,
        ties: 0
      };

      function computerchoicer(){
        let computer = Math.random();
        if (computer >= 0 && computer < 1/3){
          computerchoice = `ROCK`;
        }else if (computer >= 1/3 && computer < 1/2){
          computerchoice = `PAPER`;
        }else if (computer >= 1/2 && computer <= 1){
          computerchoice = `SCISSORS`;
        }
        return computerchoice;
      };



      
        //autoplay function
        let isAutoPlaying = false;
        let intervalID;

        document.querySelector(".auto-play-button").addEventListener("click", function(){
          if (!isAutoPlaying){
            intervalID = setInterval(function(){
              let playermove = computerchoicer();
              StartGame(playermove);
              document.querySelector(".auto-play-button").textContent = `Stop Play`;
            }, 100);
            isAutoPlaying = true;
  
          }else {
            clearInterval(intervalID);
            isAutoPlaying = false;
            document.querySelector(".auto-play-button").textContent = `Auto Play`;
          }
        });
        
    
        //key down method




      showresult()
      let popup;
      function StartGame(user){
        
        computerchoicer();
        
        if (computerchoice === user){
          result.ties += 1;
          popup = `TIES`;
        }else if (computerchoice === `ROCK` && user === `SCISSORS`  || computerchoice === `PAPER` && user === `ROCK` || computerchoice === `SCISSORS` && user === `PAPER` ){
          result.losses += 1;
          popup = `YOU LOSS!`;
        }else {
          result.win += 1;
          popup = `YOU WIN !`;
        }
        localStorage.setItem('result',JSON.stringify(result));
        showresult();
        document.querySelector(".scoreChoice").textContent = popup;

        
        document.querySelector(".Choices").innerHTML = (`You: ${chosing_img(user) } - Computer: ${chosing_img(computerchoice)}`);
      }

      function chosing_img(para){
        if (para === 'ROCK'){
          return '<img class="result_img" src="images/rock-emoji.png">';
        }else if (para === 'PAPER'){
          return `<img class="result_img" src="images/paper-emoji.png">`;
        }else if (para === 'SCISSORS'){
          return `<img class="result_img" src="images/scissors-emoji.png">`;
        }
      };


     


      function showresult(){
        let saveresult = JSON.parse(localStorage.getItem('result'));
        document.querySelector(".scoreText").textContent = (`score: \nWins: ${saveresult.win}\nLosses: ${saveresult.losses}\nTies:  ${saveresult.ties}`);;
      }
      
       function resetresult(){
        Object.assign(result, {win: 0, losses: 0, ties: 0});
        localStorage.setItem('result',JSON.stringify(result));
        showresult()
      }

      //calling buttons 
const button_ch = {
  ROCK: document.querySelector('.Rock_b'),
  PAPER: document.querySelector('.Paper_b'),
  SCISSORS: document.querySelector('.Scissors_b')
};

button_ch.ROCK.addEventListener("click", function(){
  StartGame('ROCK')
});

button_ch.PAPER.addEventListener("click", function(){
  StartGame('PAPER')
});

button_ch.SCISSORS.addEventListener("click", function(){
  StartGame('SCISSORS')
});


document.querySelector('body').addEventListener("keydown", function(event){
  console.log(event.key);
  if (event.key === 'r' || event.key === 'R'){
    StartGame('ROCK');
  }else if (event.key === 'p'|| event.key === 'P'){
    StartGame('PAPER');
  }if (event.key === 's'|| event.key === 'S'){
    StartGame('SCISSORS');
  }
})
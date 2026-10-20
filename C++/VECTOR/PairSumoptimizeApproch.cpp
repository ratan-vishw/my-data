#include<iostream>
#include<vector>
using namespace std;
// Optimize pair sum approch 
vector<int> pairsum(vector<int> arry, int target){
  vector<int> ans;
  int size = arry.size();
  int i = 0, j = size - 1;
  while(i < j){
    int pairsum = arry[i] + arry[j];
    if (pairsum < target){
      i++;
    }else if (pairsum > target){
      j--;
    }else {
      ans.push_back(arry[i]);
      ans.push_back(arry[j]);
      return ans;
    }
  }
  return ans;
}
int  main (){
  vector<int> arry = {1, 2, 3, 4, 5};
  int target = 9;
  vector<int> ans = pairsum(arry, target);
  for (int answer: ans){
    cout<<answer<<" ";
  }
  return 0;
}